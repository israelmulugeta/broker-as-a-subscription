CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  phone VARCHAR(32),
  password_hash TEXT NOT NULL,
  subscription_status VARCHAR(20) NOT NULL DEFAULT 'inactive',
  subscription_expiry TIMESTAMP,
  type VARCHAR(20) NOT NULL CHECK (type IN ('landlord', 'seller', 'renter', 'buyer', 'admin')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  location VARCHAR(200) NOT NULL,
  size NUMERIC(12,2) NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'rented')),
  images JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preferences (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  location VARCHAR(200) NOT NULL,
  size NUMERIC(12,2) NOT NULL,
  price_range_min NUMERIC(14,2) NOT NULL,
  price_range_max NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMP NOT NULL,
  UNIQUE(property_id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id),
  buyer_id INT NOT NULL REFERENCES users(id),
  amount NUMERIC(14,2) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('rent', 'sale')),
  fee_amount NUMERIC(14,2) NOT NULL,
  completed_at TIMESTAMP NOT NULL
);
