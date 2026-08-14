-- Shiprocket shipping integration: shipment tracking fields on orders
ALTER TABLE orders ADD COLUMN shiprocket_order_id TEXT;
ALTER TABLE orders ADD COLUMN shiprocket_shipment_id TEXT;
ALTER TABLE orders ADD COLUMN shiprocket_status TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_shipment ON orders(shiprocket_shipment_id);
