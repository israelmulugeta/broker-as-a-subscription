# DirectProperty ET

Complete property listing platform for Ethiopia with a GitHub Pages-ready static frontend and Node.js/Express/PostgreSQL backend.

## Folder Structure

```
.
├── backend/
│   └── server.js
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── sql/
│   └── schema.sql
├── .env.example
└── package.json
```

## Features
- Landing page with Hero, How it Works, Features, Pricing, Subscribe, and Footer.
- User registration/login with JWT and subscription status.
- Add property listings (landlord/seller) and preferences (renter/buyer).
- Automated matching engine and notifications (Twilio SMS + SMTP email).
- Transaction system with fee calculations:
  - Rentals: 10%
  - Sales: 2%
- Admin APIs for users, listings, and transactions.
- Payment intent endpoint for subscriptions using Stripe (or local gateway integration point).

## Setup
1. Create PostgreSQL database `directproperty_et`.
2. Run schema:
   ```bash
   psql -d directproperty_et -f sql/schema.sql
   ```
3. Copy `.env.example` to `.env` and configure values.
4. Install dependencies and start server:
   ```bash
   npm install
   npm start
   ```

Frontend runs from `/` via Express static hosting. For GitHub Pages deployment, publish contents of `frontend/`.

## Key API Endpoints
- `POST /api/register`
- `POST /api/login`
- `POST /subscribe`
- `POST /api/properties` (auth: landlord/seller)
- `POST /api/preferences` (auth: renter/buyer)
- `POST /api/transactions` (auth: buyer/renter/admin)
- `POST /api/payments/subscription-intent`
- `GET /api/admin/users` (auth: admin)
- `GET /api/admin/listings` (auth: admin)
- `GET /api/admin/transactions` (auth: admin)
