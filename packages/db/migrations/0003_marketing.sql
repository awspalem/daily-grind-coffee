-- Marketing Hub: communication channels, social campaigns, limited editions, promotions.
-- Internal planning/tracking tables only — no external API integration.

CREATE TABLE IF NOT EXISTS communication_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL, -- EMAIL, SMS, WHATSAPP, INSTAGRAM, FACEBOOK, OTHER
    handle_or_address TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED', -- ACTIVE, INACTIVE, PLANNED
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channels_status ON communication_channels(status);

CREATE TABLE IF NOT EXISTS social_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_id TEXT REFERENCES communication_channels(id) ON DELETE SET NULL,
    objective TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, LIVE, COMPLETED
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON social_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_channel ON social_campaigns(channel_id);

CREATE TABLE IF NOT EXISTS limited_editions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    product_name TEXT,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    sku TEXT,
    launch_date DATE,
    end_date DATE,
    total_units INTEGER,
    units_sold INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'UPCOMING', -- UPCOMING, LIVE, SOLD_OUT, ENDED
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_limited_editions_status ON limited_editions(status);

CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    promo_type TEXT NOT NULL DEFAULT 'SALE', -- SALE, BUNDLE, SEASONAL, CLEARANCE
    start_date DATE,
    end_date DATE,
    linked_coupon_id TEXT REFERENCES coupons(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, ACTIVE, ENDED
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
