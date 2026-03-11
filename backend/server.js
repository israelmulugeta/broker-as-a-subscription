require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { body, validationResult } = require('express-validator');
const twilio = require('twilio');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('frontend'));

const SUBSCRIPTION_PRICE_BIRR = 500;
const RENTAL_FEE_RATE = 0.1;
const SALE_FEE_RATE = 0.02;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/directproperty_et'
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const mailTransporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        : undefined
    })
  : null;

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'directproperty-secret');
      if (requiredRoles.length && !requiredRoles.includes(payload.type) && payload.type !== 'admin') {
        return res.status(403).json({ error: 'Forbidden for this user type' });
      }
      req.user = payload;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function buildSubscriptionStatus(expiryDate) {
  if (!expiryDate) return 'inactive';
  const now = new Date();
  return new Date(expiryDate) > now ? 'active' : 'inactive';
}

async function notifyMatch(user, property) {
  const messages = [];

  if (twilioClient && user.phone) {
    try {
      await twilioClient.messages.create({
        body: `DirectProperty ET match: ${property.type} at ${property.location} for ${property.price} Birr.`,
        from: process.env.TWILIO_FROM,
        to: user.phone
      });
      messages.push('sms_sent');
    } catch (error) {
      messages.push(`sms_failed:${error.message}`);
    }
  }

  if (mailTransporter && user.email) {
    try {
      await mailTransporter.sendMail({
        from: process.env.NOTIFY_FROM || 'no-reply@directproperty.et',
        to: user.email,
        subject: 'DirectProperty ET - New Property Match',
        text: `A new ${property.type} in ${property.location} (${property.size} sqm) matched your preferences. Price: ${property.price} Birr.`
      });
      messages.push('email_sent');
    } catch (error) {
      messages.push(`email_failed:${error.message}`);
    }
  }

  return messages;
}

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post(
  '/api/register',
  [
    body('name').notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('type').isIn(['landlord', 'seller', 'renter', 'buyer', 'admin'])
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, type, phone } = req.body;

    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, type, phone, subscription_status)
         VALUES ($1, $2, $3, $4, $5, 'inactive')
         RETURNING id, name, email, type, subscription_status`,
        [name, email, passwordHash, type, phone || null]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post('/api/login', [body('email').isEmail(), body('password').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, type: user.type, email: user.email },
      process.env.JWT_SECRET || 'directproperty-secret',
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        subscription_status: buildSubscriptionStatus(user.subscription_expiry),
        subscription_expiry: user.subscription_expiry
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/subscribe', [body('name').notEmpty(), body('email').isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;
  try {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);

    const result = await pool.query(
      `UPDATE users
       SET subscription_status = 'active', subscription_expiry = $1
       WHERE email = $2
       RETURNING id, email, subscription_status, subscription_expiry`,
      [expiry.toISOString(), email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Please register first before subscribing' });
    }

    return res.json({
      message: `Subscription activated for ${SUBSCRIPTION_PRICE_BIRR} Birr/year`,
      user: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post(
  '/api/properties',
  auth(['landlord', 'seller']),
  [
    body('type').isIn(['apartment', 'house', 'villa', 'commercial', 'land']),
    body('location').notEmpty(),
    body('size').isFloat({ gt: 0 }),
    body('price').isFloat({ gt: 0 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, location, size, price, images = [] } = req.body;
    try {
      const insert = await pool.query(
        `INSERT INTO properties (owner_id, type, location, size, price, status, images)
         VALUES ($1, $2, $3, $4, $5, 'available', $6)
         RETURNING *`,
        [req.user.id, type, location, size, price, JSON.stringify(images)]
      );
      const property = insert.rows[0];

      const matchingPrefs = await pool.query(
        `SELECT p.user_id, u.email, u.phone, p.type AS preference_type, p.location AS preference_location,
                p.size AS preference_size, p.price_range_min, p.price_range_max
         FROM preferences p
         JOIN users u ON u.id = p.user_id
         WHERE p.type = $1
         AND p.location ILIKE $2
         AND p.size <= $3
         AND p.price_range_min <= $4
         AND p.price_range_max >= $4`,
        [type, `%${location}%`, size, price]
      );

      for (const pref of matchingPrefs.rows) {
        const existing = await pool.query(
          'SELECT id FROM matches WHERE property_id = $1 AND user_id = $2',
          [property.id, pref.user_id]
        );
        if (!existing.rows.length) {
          await pool.query(
            'INSERT INTO matches (property_id, user_id, notified_at) VALUES ($1, $2, NOW())',
            [property.id, pref.user_id]
          );
          await notifyMatch(pref, property);
        }
      }

      return res.status(201).json({ property, matches_found: matchingPrefs.rows.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post(
  '/api/preferences',
  auth(['renter', 'buyer']),
  [
    body('type').isIn(['apartment', 'house', 'villa', 'commercial', 'land']),
    body('location').notEmpty(),
    body('size').isFloat({ gt: 0 }),
    body('price_range_min').isFloat({ gt: 0 }),
    body('price_range_max').isFloat({ gt: 0 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, location, size, price_range_min, price_range_max } = req.body;
    if (price_range_min > price_range_max) {
      return res.status(400).json({ error: 'price_range_min must be <= price_range_max' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO preferences (user_id, type, location, size, price_range_min, price_range_max)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [req.user.id, type, location, size, price_range_min, price_range_max]
      );
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post(
  '/api/transactions',
  auth(['buyer', 'renter', 'admin']),
  [body('property_id').isInt(), body('amount').isFloat({ gt: 0 }), body('type').isIn(['rent', 'sale'])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { property_id, amount, type } = req.body;
    const feeAmount = type === 'rent' ? amount * RENTAL_FEE_RATE : amount * SALE_FEE_RATE;

    try {
      const propertyStatus = type === 'rent' ? 'rented' : 'sold';
      const tx = await pool.query(
        `INSERT INTO transactions (property_id, buyer_id, amount, type, fee_amount, completed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [property_id, req.user.id, amount, type, feeAmount]
      );

      await pool.query('UPDATE properties SET status = $1 WHERE id = $2', [propertyStatus, property_id]);
      return res.status(201).json(tx.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);

app.post('/api/payments/subscription-intent', auth(), async (req, res) => {
  if (!stripe) {
    return res.status(400).json({
      error: 'Stripe is not configured. Integrate M-Birr/CBE Birr or provide STRIPE_SECRET_KEY.'
    });
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: SUBSCRIPTION_PRICE_BIRR * 100,
      currency: 'etb',
      metadata: { user_id: String(req.user.id), purpose: 'subscription' }
    });
    return res.json({ clientSecret: intent.client_secret });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/users', auth(['admin']), async (_, res) => {
  const result = await pool.query(
    'SELECT id, name, email, type, subscription_status, subscription_expiry, created_at FROM users ORDER BY created_at DESC'
  );
  return res.json(result.rows);
});

app.get('/api/admin/listings', auth(['admin']), async (_, res) => {
  const result = await pool.query('SELECT * FROM properties ORDER BY created_at DESC');
  return res.json(result.rows);
});

app.get('/api/admin/transactions', auth(['admin']), async (_, res) => {
  const result = await pool.query('SELECT * FROM transactions ORDER BY completed_at DESC');
  return res.json(result.rows);
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`DirectProperty ET server running on port ${PORT}`);
});
