-- Migration 0012 — Phase 1: customer identity & profile.
--
-- Three concerns, three tables:
--   1. customer_profiles       — the materialised taste graph (derived, disposable, rebuildable)
--   2. customer_preferences    — what the customer explicitly told us (authoritative, never derived)
--   3. customer_channel_optins — per-customer consent against the existing marketing channels
--
-- Nothing here edits an already-applied CREATE TABLE. `customers` is deliberately left alone:
-- migration 0013 (loyalty) is landing on that table in parallel, and preferences are a
-- one-to-one side table anyway, so a JOIN costs nothing and the two features never collide.
-- (See the 0001/0007 `subscriptions` double-declaration for why editing an old CREATE is fatal.)

-- 1. Derived profile snapshot -------------------------------------------------------------
--
-- Every column here is COMPUTED from orders + order_items + products + reviews. It is a cache:
-- deleting a row is always safe, the next read recomputes it. It exists so that the barista,
-- the recommendations endpoint and (later) replenishment automation can all read a customer's
-- taste in one indexed row lookup instead of re-running a five-table aggregate each time.
CREATE TABLE IF NOT EXISTS customer_profiles (
    customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,

    -- Recency / frequency / monetary. Money is in the same stored cents as orders.total_cents;
    -- orders.currency is still 'usd' by default (gap 0.2, owned by Phase 0) so no conversion is
    -- attempted here — the snapshot reports whatever unit the orders were written in.
    total_orders INTEGER NOT NULL DEFAULT 0,
    lifetime_value_cents INTEGER NOT NULL DEFAULT 0,
    aov_cents INTEGER NOT NULL DEFAULT 0,
    first_order_at DATETIME,
    last_order_at DATETIME,
    days_since_last_order INTEGER,
    reorder_cadence_days REAL,          -- mean days between consecutive orders; NULL until 2 orders

    -- Taste graph headlines. The full distributions live in the *_json columns below; these are
    -- the denormalised "winner" of each so common queries never have to parse JSON.
    favourite_grind TEXT,
    typical_weight_grams INTEGER,
    top_roast_level TEXT,
    top_origin_country TEXT,
    top_product_id TEXT,

    -- JSON arrays of { key, units, share } — see services/customerProfile.ts.
    roast_distribution_json TEXT NOT NULL DEFAULT '[]',
    origin_distribution_json TEXT NOT NULL DEFAULT '[]',
    process_distribution_json TEXT NOT NULL DEFAULT '[]',
    product_affinity_json TEXT NOT NULL DEFAULT '[]',

    -- Review signal. reviews has no customer_id (0005), only a self-reported order_number, so
    -- this is joined back through orders and is therefore sparse by nature.
    review_count INTEGER NOT NULL DEFAULT 0,
    avg_review_rating REAL,
    top_rated_product_id TEXT,

    segment TEXT NOT NULL DEFAULT 'NEW', -- NEW, ACTIVE, LOYAL, VIP, AT_RISK, LAPSED
    computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_segment ON customer_profiles(segment);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_computed ON customer_profiles(computed_at);

-- 2. Explicitly saved preferences ---------------------------------------------------------
--
-- Kept apart from customer_profiles because these are stated, not inferred: a customer who sets
-- their default grind to ESPRESSO must not have it overwritten by a snapshot rebuild.
CREATE TABLE IF NOT EXISTS customer_preferences (
    customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    default_grind TEXT,                 -- GrindType, e.g. WHOLE_BEAN, SOUTH_INDIAN_FILTER
    default_weight_grams INTEGER,       -- 250, 500, 1000
    brew_method TEXT,                   -- free-text-ish: v60, aeropress, south-indian-filter...
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Communication opt-ins ----------------------------------------------------------------
--
-- `communication_channels` (0003) is a marketing CATALOG of channels — it has no customer
-- column and never should, so consent is a join table rather than an ALTER on that table.
CREATE TABLE IF NOT EXISTS customer_channel_optins (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
    opted_in BOOLEAN NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(customer_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_optins_customer ON customer_channel_optins(customer_id);

-- The channel catalog ships empty, which would leave the opt-in UI with nothing to render.
-- Seeded with fixed ids (rather than UUIDs) so the migration is idempotent and so the API can
-- reason about the three channels that actually matter for an India-facing storefront.
INSERT OR IGNORE INTO communication_channels (id, name, channel_type, status, notes)
VALUES
    ('chan_email',    'Roastery Email',    'EMAIL',    'ACTIVE',  'Order updates, new-arrival and restock announcements.'),
    ('chan_sms',      'SMS Alerts',        'SMS',      'ACTIVE',  'Dispatch and delivery notifications.'),
    ('chan_whatsapp', 'WhatsApp Concierge','WHATSAPP', 'PLANNED', 'Brew help and replenishment nudges.');
