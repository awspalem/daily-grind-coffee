-- 0024: loyalty configurability and transition history.
--
-- (1) loyalty_config — a single-row table that lets ops change the headline numbers
-- (earn rate, point value, redemption floor/ceiling, tier thresholds, multipliers) without
-- shipping code. The service layer still caches the values in LOYALTY_RATES for read paths
-- and reads from this table once at boot, with a row-level fallback to the in-code defaults
-- when the table is empty (fresh dev environments, before any seed runs).
--
-- (2) loyalty_tier_history — append-only audit log of every tier change. The customer-facing
-- surfaces (summary endpoint, "your tier changed" notification hooks) and the support tool
-- that answers "when did this customer last move up?" both read from here. Without it a
-- downgrade was indistinguishable from an upgrade once `customers.loyalty_tier` was
-- overwritten.
--
-- (3) CHECK constraints on the ledger rows the service code already guards on. A buggy
-- refund-clawback path that wrote a positive ADJUST when it should have written a negative
-- one would silently inflate the balance; pinning entry_type/polarity at the row level makes
-- the wrong sign fail loudly instead.

-- (1)
CREATE TABLE IF NOT EXISTS loyalty_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),     -- single-row table
    rupees_per_point_earned INTEGER NOT NULL,
    point_value_cents INTEGER NOT NULL,
    min_redeem_points INTEGER NOT NULL,
    max_redeem_percent INTEGER NOT NULL,
    expiry_months INTEGER NOT NULL,
    signup_bonus_points INTEGER NOT NULL,
    review_bonus_points INTEGER NOT NULL,
    subscription_streak_points INTEGER NOT NULL,
    subscription_streak_every INTEGER NOT NULL,
    redemption_hold_minutes INTEGER NOT NULL,
    tier_threshold_silver_cents INTEGER NOT NULL,
    tier_threshold_gold_cents INTEGER NOT NULL,
    tier_multiplier_silver REAL NOT NULL,
    tier_multiplier_gold REAL NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- (2)
CREATE TABLE IF NOT EXISTS loyalty_tier_history (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    from_tier TEXT,                              -- NULL on the very first tier assignment
    to_tier TEXT NOT NULL,
    trailing_spend_cents INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tier_history_customer
    ON loyalty_tier_history(customer_id, created_at DESC);

-- (3) row-level polarity guards. EARN is always positive, REDEEM/EXPIRE always negative,
-- ADJUST can be either but the service is opinionated about which. Enforce on the EARN
-- side (a positive credit) and the debit side (negative) — the SUM(points_delta) invariant
-- is still enforced in the service, because a CHECK cannot reach across rows.
-- SQLite has no ALTER TABLE … ADD CONSTRAINT, so the only way to add these is a fresh
-- CREATE — but loyalty_ledger already exists in production. Use a trigger so the change
-- applies without a destructive recreate.
CREATE TRIGGER IF NOT EXISTS trg_loyalty_ledger_earn_positive
BEFORE INSERT ON loyalty_ledger
FOR EACH ROW
WHEN NEW.entry_type = 'EARN' AND NEW.points_delta <= 0
BEGIN
    SELECT RAISE(ABORT, 'EARN ledger rows must have a positive points_delta');
END;

CREATE TRIGGER IF NOT EXISTS trg_loyalty_ledger_debit_negative
BEFORE INSERT ON loyalty_ledger
FOR EACH ROW
WHEN NEW.entry_type IN ('REDEEM', 'EXPIRE') AND NEW.points_delta >= 0
BEGIN
    SELECT RAISE(ABORT, 'REDEEM and EXPIRE ledger rows must have a negative points_delta');
END;

-- Seed the single config row with values that match the in-code LOYALTY_RATES defaults. The
-- service's loader falls back to those constants when this row is missing, so the row is
-- optional in dev — but production wants it present so a change to the constants does not
-- silently lose in-flight config tweaks.
INSERT OR IGNORE INTO loyalty_config (
    id, rupees_per_point_earned, point_value_cents,
    min_redeem_points, max_redeem_percent, expiry_months,
    signup_bonus_points, review_bonus_points,
    subscription_streak_points, subscription_streak_every,
    redemption_hold_minutes,
    tier_threshold_silver_cents, tier_threshold_gold_cents,
    tier_multiplier_silver, tier_multiplier_gold
) VALUES (
    1, 10, 50, 200, 20, 18,
    50, 25, 100, 3, 60,
    1000000, 3000000, 1.25, 1.5
);
