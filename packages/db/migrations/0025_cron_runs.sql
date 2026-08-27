-- 0024: cron run telemetry.
--
-- The API has a single scheduled handler in apps/api/src/index.ts that fans
-- out to several jobs (booking holds, waitlist, reminders, entitlement
-- expiry, product-embedding backfill, dashboard rollup, D1->R2 backup,
-- expired-cart cleanup, abandoned-checkout release, subscription renewals,
-- review emails). There is no per-job liveness signal today: if one of
-- them stops firing, the only way to find out is the absence of a
-- downstream effect (reminders not arriving, backups not landing in R2,
-- etc.) — which is silent until a customer notices.
--
-- This table records one row per job per scheduled tick. The scheduled
-- handler in index.ts writes a status='RUNNING' row at the start of each
-- job and a status='OK' or 'ERROR' row at the end. /api/health joins on
-- it to surface "last successful run per job", which is the actual
-- question an operator asks.

CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  duration_ms INTEGER,
  error_message TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started
  ON cron_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_runs_status_started
  ON cron_runs (status, started_at DESC);
