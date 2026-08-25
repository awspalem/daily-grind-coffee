-- Migration 0014 — Referral: durable codes, attribution, fraud guards, dashboard counters.
--
-- Depends on 0013 (referrer rewards are paid as loyalty points through `loyalty_ledger`).

-- One durable code per customer. The code is the customer's public identity in a share link,
-- so it never rotates: an old WhatsApp forward must keep working.
CREATE TABLE IF NOT EXISTS referral_codes (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per referred order. `referee_email_norm` is the lowercased/trimmed email; the partial
-- UNIQUE index below is the actual "one reward per referee, ever" guard — application-level
-- SELECT-then-INSERT would let two concurrent checkouts both pass.
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    referee_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    referee_email_norm TEXT NOT NULL,
    referee_phone TEXT,
    order_id TEXT UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ATTRIBUTED',  -- ATTRIBUTED, QUALIFIED, REVERSED, BLOCKED
    referee_discount_cents INTEGER NOT NULL DEFAULT 0,
    referrer_points_awarded INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT,                        -- SELF_EMAIL, SELF_PHONE, SELF_ADDRESS, ALREADY_REFERRED, EXISTING_CUSTOMER
    qualified_at DATETIME,                      -- set when the referred order was delivered
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A referee can be rewarded once in their lifetime. BLOCKED rows are kept for audit and are
-- excluded so a blocked attempt never permanently burns the email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_one_per_referee
    ON referrals(referee_email_norm) WHERE status <> 'BLOCKED';

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_customer_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);

-- Share-link landings, so the dashboard can show "invited" rather than only "purchased".
-- `visitor_hash` is a coarse hash of IP+UA, not an identifier we can reverse.
CREATE TABLE IF NOT EXISTS referral_visits (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    referrer_customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    visitor_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One landing per visitor per code counts as one invite, so refreshing the link cannot inflate
-- the dashboard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_visits_unique ON referral_visits(code, visitor_hash);
CREATE INDEX IF NOT EXISTS idx_referral_visits_referrer ON referral_visits(referrer_customer_id);

-- Attribution needs the code that was used at checkout to survive on the order itself, so the
-- delivery hook can find it without a join through a mutable table.
ALTER TABLE orders ADD COLUMN referral_code TEXT;
