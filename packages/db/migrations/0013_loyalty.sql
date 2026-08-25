-- Migration 0013 — Loyalty: points ledger, redemption, tiers, expiry.
--
-- Replaces the `customers.loyalty_points` stub (a bare mutable integer, hardcoded to 50 at
-- signup and never earned or spent) with an immutable ledger. Same shape as
-- `inventory_movements` and `entitlement_ledger`: the ledger is the truth,
-- `customers.loyalty_points` becomes a cached rollup that the service keeps in sync.
--
-- Never add a column by editing an already-applied CREATE (0001 and 0007 both declare
-- `subscriptions`, so one of them silently lost) — everything below is a new table or an
-- ALTER TABLE.

-- Append-only movement log. One row per earn / redeem / expire / adjust.
--
-- BALANCE INVARIANT: the authoritative balance is SUM(points_delta) over all of a customer's
-- rows. The two lot columns below (`expires_at`, `points_consumed`) exist *only* to schedule
-- FIFO expiry; they are not a second balance and must never be treated as one. A refund
-- clawback can push SUM(points_delta) below what the open lots hold, which is why expiry
-- clamps to the authoritative balance rather than to the lot remainder.
--
-- There is deliberately no `balance_after` column (unlike inventory_movements): expiry is
-- evaluated lazily at read time, so EXPIRE rows are written out of chronological order and a
-- stored running balance would not read monotonically in the customer statement.
CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,           -- EARN, REDEEM, EXPIRE, ADJUST
    reason TEXT NOT NULL,               -- SIGNUP_BONUS, ORDER_DELIVERED, REVIEW_BONUS, SUBSCRIPTION_STREAK,
                                        -- REFERRAL_REWARD, ORDER_REDEEM, REDEEM_RECLAIMED, REFUND_CLAWBACK,
                                        -- REFUND_RESTORE, POINTS_EXPIRED, ADMIN_ADJUST
    points_delta INTEGER NOT NULL,      -- positive = credited, negative = spent/expired/clawed back
    ref_type TEXT,                      -- ORDER, REVIEW, REFERRAL, ADMIN, LEDGER
    ref_id TEXT,
    -- Lot bookkeeping. Populated on EARN rows only; NULL elsewhere.
    expires_at DATETIME,                -- when this lot lapses (NULL = never)
    points_consumed INTEGER NOT NULL DEFAULT 0, -- how much of this lot has been spent or expired
    note TEXT,                          -- customer-visible statement line
    idempotency_key TEXT UNIQUE,        -- a retried award/redemption is a no-op, never a second credit
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_customer ON loyalty_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_ref ON loyalty_ledger(ref_type, ref_id);
-- Drives the FIFO spend/expire scan: open lots for one customer, oldest first.
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_lots ON loyalty_ledger(customer_id, entry_type, expires_at);

-- Cached rollups on the customer. `loyalty_points` (from 0001) stays as the current balance.
ALTER TABLE customers ADD COLUMN loyalty_points_lifetime INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN loyalty_tier TEXT NOT NULL DEFAULT 'BRONZE';   -- BRONZE, SILVER, GOLD
ALTER TABLE customers ADD COLUMN loyalty_tier_updated_at DATETIME;

-- Redemption is recorded on the order so a refund can reverse exactly what was spent, and so
-- the coupon and points halves of `orders.discount_cents` stay separable (coupon_redemptions
-- must keep recording the coupon's share only).
ALTER TABLE orders ADD COLUMN loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN loyalty_discount_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status);
