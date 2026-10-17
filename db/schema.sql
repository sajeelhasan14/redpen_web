-- Emails only, plus what a student chooses to tell us about their course. No student work is stored here.
CREATE TABLE IF NOT EXISTS waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('parent', 'student')),
  board TEXT NULL,
  token TEXT NOT NULL UNIQUE,
  confirmed_at TIMESTAMPTZ NULL,
  unsubscribed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  paddle_txn_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  board TEXT NULL,
  amount_pence INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL CHECK (status IN ('completed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_stats (
  day DATE PRIMARY KEY,
  checks INTEGER NOT NULL DEFAULT 0,
  errors_caught INTEGER NOT NULL DEFAULT 0,
  teach_taps INTEGER NOT NULL DEFAULT 0
);

-- October 2026: the list is for US calculus students. What they are taking, where, and when their exam is.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS course TEXT NULL;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS school TEXT NULL;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS exam_date DATE NULL;
