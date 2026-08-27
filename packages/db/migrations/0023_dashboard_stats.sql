-- 0023: pre-aggregated dashboard rollup.
--
-- /api/admin/dashboard currently runs four full-table aggregates on every
-- page load: COUNT/SUM/AVG over all orders, a GROUP BY status breakdown,
-- a COUNT(*) over all inventory, and a LIMIT 8 recent-orders query. The
-- dashboard is the landing page — it pays this cost on every visit, on
-- every admin refresh, on every nav.
--
-- This table holds one row per local date with the same aggregates. The
-- hourly cron in services/maintenance.ts rolls up the previous day after
-- midnight; the dashboard read switches to a one-row SELECT against
-- today's row (falling back to a live aggregate for the current, not-yet-
-- rolled-up day).

CREATE TABLE IF NOT EXISTS dashboard_stats (
  bucket_date DATE PRIMARY KEY,
  orders_total INTEGER NOT NULL DEFAULT 0,
  orders_paid INTEGER NOT NULL DEFAULT 0,
  orders_pending INTEGER NOT NULL DEFAULT 0,
  orders_cancelled INTEGER NOT NULL DEFAULT 0,
  revenue_cents_total INTEGER NOT NULL DEFAULT 0,
  avg_order_cents INTEGER NOT NULL DEFAULT 0,
  inventory_units_total INTEGER NOT NULL DEFAULT 0,
  status_breakdown_json TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
