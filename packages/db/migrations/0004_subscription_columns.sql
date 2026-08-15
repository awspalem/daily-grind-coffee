-- 0001_init.sql was edited after the live database's initial deploy to add
-- subscription_frequency/custom_notes to cart_items and order_items (for the Subscriptions
-- Club feature), but D1 migrations are tracked by filename — editing an already-applied
-- migration file doesn't reapply it. The live tables never got these columns, breaking
-- POST /api/cart/items and checkout order-item inserts with "no column named
-- subscription_frequency". Adding them here the same way 0002_shiprocket.sql did.
ALTER TABLE cart_items ADD COLUMN subscription_frequency TEXT;
ALTER TABLE cart_items ADD COLUMN custom_notes TEXT;
ALTER TABLE order_items ADD COLUMN subscription_frequency TEXT;
ALTER TABLE order_items ADD COLUMN custom_notes TEXT;
