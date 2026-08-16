-- Tracks whether a post-delivery review-request email has been sent for an order, so the cron
-- job (index.ts scheduled()) sends it exactly once per delivered order.
ALTER TABLE orders ADD COLUMN review_request_sent_at DATETIME;
