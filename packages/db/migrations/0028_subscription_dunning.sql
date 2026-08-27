-- Migration 0024 — Subscription dunning state and audit hooks.
--
-- The renewal cron marks a subscription PAST_DUE on the first failed off-session charge and never
-- looks at those rows again (`WHERE status = 'ACTIVE'`), so before this migration the state was a
-- dead end: every retry attempt, every dunning email and the final cancellation had to live in
-- head. This adds the columns the retry policy needs to be encoded in the database, the way every
-- other state machine in the app encodes its state.
--
-- Idempotency-friendly: nullable defaults, no NOT NULL, no UNIQUE, so the ALTER can run against
-- rows that have already been sitting in PAST_DUE for some time. The cron backfills past_due_at
-- on first sight for those rows.
--
-- Day 0 / 3 / 7 / 14 schedule: PAST_DUE lands on day 0, Stripe retries on day 3 and day 7, and
-- the row is CANCELLED on day 14 if no card update has been supplied. next_retry_at is what the
-- cron selects on; past_due_retry_count is the audit trail of how many attempts failed.

ALTER TABLE subscriptions ADD COLUMN past_due_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN past_due_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN next_retry_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN last_dunning_email_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due ON subscriptions(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due_at ON subscriptions(past_due_at);

-- Extend the event log's allowed types with the dunning transitions. The CHECK isn't enforceable
-- in SQLite (no ALTER CONSTRAINT), so the list of event types here mirrors what
-- recordSubscriptionEvent writes — keep both in sync if a new transition is added.
