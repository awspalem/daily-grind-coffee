-- 0022: indexes the rest of the schema assumes exist.
--
-- 0001_init.sql declared UNIQUE constraints on orders.stripe_session_id and
-- orders.stripe_payment_intent_id, but never added backing indexes. Every
-- Stripe webhook lands on `SELECT ... WHERE stripe_session_id = ?` and the
-- only thing keeping it from being a full table scan today is the size of the
-- orders table. These also keep customer-facing reads cheap: orders-by-customer
-- and the recent-orders feeds both benefit.

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stripe_session
    ON orders(stripe_session_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent
    ON orders(stripe_payment_intent_id);

-- The admin dashboard's recent orders, the customer's order history, and the
-- nightly stats rollup all ORDER BY created_at DESC. The existing
-- idx_orders_status doesn't help the sort and falls back to a sort step.
CREATE INDEX IF NOT EXISTS idx_orders_created_at
    ON orders(created_at DESC);

-- admin/orders/:id, refund lookups, and the customer-id branch of
-- /api/customer/orders all filter by customer_id directly.
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
    ON orders(customer_id);

-- The storefront catalog reads `WHERE is_active = 1` (see getAllProducts in
-- packages/db/src/index.ts). Without this index, every cold catalog load
-- scans the products table; with it, the active set is one seek.
CREATE INDEX IF NOT EXISTS idx_products_is_active
    ON products(is_active);

-- customer_login_codes is hit on every magic-link submission with
-- `WHERE email = ? AND code_hash = ? AND consumed_at IS NULL`. The current
-- index is email-only, so the code_hash match is a per-email scan. A composite
-- (email, code_hash) index turns it into an equality seek.
CREATE INDEX IF NOT EXISTS idx_login_codes_email_hash
    ON customer_login_codes(email, code_hash);
