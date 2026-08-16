-- The `subscriptions` table itself was added to 0001_init.sql in a later edit, after that
-- migration had already been applied to the live database (same root cause as the
-- cart_items/order_items missing-columns bug fixed in 0004) — it was never actually created.
-- Every "Subscribe & Save" checkout has been failing outright (the INSERT INTO subscriptions
-- runs in the same D1 batch as the order/order_items inserts, so the whole checkout failed with
-- "no such table: subscriptions", not just the subscription part). Creating it here for real.
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
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED, PAST_DUE
    next_renewal_date DATETIME NOT NULL,
    shipping_address_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(customer_email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Captures the Stripe customer + saved payment method from the initial checkout so the renewal
-- cron (index.ts scheduled()) can charge off-session.
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_payment_method_id TEXT;
