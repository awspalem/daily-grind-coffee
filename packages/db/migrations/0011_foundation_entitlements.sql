-- Migration 0011 — Platform foundation: entitlement grants.
--
-- Shared contract between subscription plans/tiers (migration 0015) and bookable experiences
-- (migration 0016). Plans GRANT entitlements; bookings CONSUME them. Neither side owns these
-- tables, which is why they live here rather than in either feature's migration.
--
-- NOTE ON THIS FILE'S NUMBER: migrations 0001 and 0007 both `CREATE TABLE IF NOT EXISTS
-- subscriptions`, so whichever ran first silently won and the other became a no-op. Never add a
-- column by editing an already-applied CREATE — always ALTER TABLE in a new migration.

-- A grant is a bucket of units (consultation credits, free tour seats, free shipping uses...)
-- issued to one customer from one source, with its own validity window.
CREATE TABLE IF NOT EXISTS entitlement_grants (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    entitlement_code TEXT NOT NULL,     -- e.g. CONSULT_15MIN, TOUR_SEAT, CUPPING_SEAT, FREE_SHIPPING, EARLY_ACCESS
    source_type TEXT NOT NULL,          -- SUBSCRIPTION, PLAN_RENEWAL, PROMO, LOYALTY_TIER, MANUAL
    source_id TEXT,                     -- subscription id / promo id / admin actor, nullable
    total_units INTEGER NOT NULL,       -- -1 means unlimited for the window (e.g. FREE_SHIPPING)
    used_units INTEGER NOT NULL DEFAULT 0,
    starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,                -- NULL = never expires
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, EXHAUSTED, EXPIRED, REVOKED
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ent_grants_customer ON entitlement_grants(customer_id, entitlement_code);
CREATE INDEX IF NOT EXISTS idx_ent_grants_status ON entitlement_grants(status);
CREATE INDEX IF NOT EXISTS idx_ent_grants_source ON entitlement_grants(source_type, source_id);

-- Immutable append-only movement log, mirroring inventory_movements. `used_units` on the grant
-- is a cached rollup of these rows; this table is the audit trail and the thing that makes a
-- release/refund reversible.
CREATE TABLE IF NOT EXISTS entitlement_ledger (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES entitlement_grants(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    entitlement_code TEXT NOT NULL,
    delta_units INTEGER NOT NULL,       -- negative = consumed, positive = released/restored
    reason TEXT NOT NULL,               -- BOOKING_CONFIRMED, BOOKING_CANCELLED, NO_SHOW, ADMIN_ADJUST
    ref_type TEXT,                      -- BOOKING, ORDER, ADMIN
    ref_id TEXT,
    idempotency_key TEXT UNIQUE,        -- prevents a retried consume from double-spending
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ent_ledger_grant ON entitlement_ledger(grant_id);
CREATE INDEX IF NOT EXISTS idx_ent_ledger_ref ON entitlement_ledger(ref_type, ref_id);
