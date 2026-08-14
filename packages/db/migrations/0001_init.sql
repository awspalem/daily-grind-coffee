-- The Daily Grind: D1 Schema Migration 0001
-- PostgreSQL/SQLite Compatible Cloudflare D1 Schema

PRAGMA foreign_keys = ON;

-- 1. Categories
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tagline TEXT,
    description TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    origin_country TEXT NOT NULL,
    region TEXT NOT NULL,
    farm_or_coop TEXT,
    altitude_meters INTEGER,
    variety TEXT,
    process_method TEXT NOT NULL, -- WASHED, NATURAL, HONEY, ANAEROBIC, WET_HULLED
    roast_level TEXT NOT NULL,    -- LIGHT, MEDIUM_LIGHT, MEDIUM, MEDIUM_DARK, DARK
    tasting_notes TEXT NOT NULL,  -- JSON Array of strings e.g. ["Jasmine", "Bergamot", "Peach"]
    acidity_score INTEGER NOT NULL DEFAULT 3,  -- 1 to 5
    body_score INTEGER NOT NULL DEFAULT 3,     -- 1 to 5
    sweetness_score INTEGER NOT NULL DEFAULT 3, -- 1 to 5
    image_url TEXT NOT NULL,
    is_featured BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_roast_level ON products(roast_level);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);

-- 3. Product Variants
CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku TEXT NOT NULL UNIQUE,
    weight_grams INTEGER NOT NULL DEFAULT 250, -- 250, 500, 1000
    price_cents INTEGER NOT NULL,              -- e.g. 1850 for $18.50
    grind_options TEXT NOT NULL,               -- JSON Array of GrindTypes
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- 4. Inventory (Current Snapshot)
CREATE TABLE IF NOT EXISTS inventory (
    variant_id TEXT PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
    sku TEXT NOT NULL UNIQUE,
    available_stock INTEGER NOT NULL DEFAULT 0,
    reserved_stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    last_restocked_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Inventory Movements Ledger (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL, -- INITIAL_STOCK, PURCHASE_RESERVE, ORDER_FULFILLED, RESTOCK, DAMAGE_ADJUSTMENT, RETURN_RESTOCK
    quantity_delta INTEGER NOT NULL, -- Positive or negative
    stock_after INTEGER NOT NULL,
    reference_type TEXT, -- ORDER, CART, ADMIN, SUPPLIER
    reference_id TEXT,
    reason TEXT,
    created_by TEXT, -- User ID or 'SYSTEM' or 'STRIPE_WEBHOOK'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_variant ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_ref ON inventory_movements(reference_type, reference_id);

-- 6. Customers & Sessions
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    phone TEXT,
    loyalty_points INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_addresses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    is_default BOOLEAN NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    line1 TEXT NOT NULL,
    line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_sessions (
    token TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Carts & Cart Items
CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    session_token TEXT NOT NULL UNIQUE,
    applied_coupon_code TEXT,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_token);

CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY,
    cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    grind_type TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price_cents INTEGER NOT NULL,
    subscription_frequency TEXT, -- 1_WEEK, 2_WEEKS, 4_WEEKS
    custom_notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Orders, Items & Payments
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', -- PENDING_PAYMENT, PAID, ROASTING, PACKED, SHIPPED, DELIVERED, CANCELLED, REFUNDED
    subtotal_cents INTEGER NOT NULL,
    shipping_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    shipping_address_json TEXT NOT NULL,
    stripe_session_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT UNIQUE,
    tracking_number TEXT,
    carrier TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_email);

CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    weight_grams INTEGER NOT NULL,
    grind_type TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_price_cents INTEGER NOT NULL,
    subscription_frequency TEXT, -- 1_WEEK, 2_WEEKS, 4_WEEKS
    custom_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 8b. Recurring Roastery Subscriptions ("The Daily Club")
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    customer_email TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
    variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    grind_type TEXT NOT NULL,
    frequency TEXT NOT NULL, -- 1_WEEK, 2_WEEKS, 4_WEEKS
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED
    next_renewal_date DATETIME NOT NULL,
    shipping_address_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(customer_email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL, -- SUCCEEDED, PENDING, FAILED, REFUNDED
    payment_method_type TEXT NOT NULL DEFAULT 'card',
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    reason TEXT NOT NULL,
    stripe_refund_id TEXT UNIQUE,
    status TEXT NOT NULL, -- PENDING, SUCCEEDED, FAILED
    created_by TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Coupons & Discounts
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL, -- PERCENT, FIXED
    discount_value INTEGER NOT NULL,
    minimum_order_cents INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    times_used INTEGER NOT NULL DEFAULT 0,
    expires_at DATETIME,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_email TEXT NOT NULL,
    discount_applied_cents INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Webhook Idempotency Registry
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY, -- Provider Event ID (e.g. evt_1234...)
    provider TEXT NOT NULL DEFAULT 'STRIPE',
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROCESSED', -- RECEIVED, PROCESSED, FAILED
    payload_json TEXT NOT NULL,
    error_message TEXT,
    processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Audit Log & Analytics
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_value_json TEXT,
    new_value_json TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL, -- product_view, add_to_cart, checkout_started, purchase
    session_id TEXT,
    product_id TEXT,
    metadata_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event_name, created_at);

-- 12. Brewing Guides (For RAG & Storefront Education)
CREATE TABLE IF NOT EXISTS brewing_guides (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    grind_recommendation TEXT NOT NULL,
    ratio_description TEXT NOT NULL,
    water_temp_celsius INTEGER NOT NULL,
    brew_time_seconds INTEGER NOT NULL,
    steps_json TEXT NOT NULL,
    pro_tips_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
