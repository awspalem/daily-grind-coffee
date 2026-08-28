-- Migration 0030 — Notification channels: web push, per-channel consent, back-in-stock waitlist.
--
-- Until now the only outbound channel was transactional email via Resend
-- (login codes, order/booking confirmations, renewal notices). This migration adds the storage
-- for three things the roadmap has been carrying as gaps (6.2, 6.10, 6.12):
--
--   * push_subscriptions   — Web Push (PWA service worker) endpoints, one row per browser.
--   * customer_channel_consent — per-customer, per-channel opt-in for OPTIONAL sends only.
--                            Transactional mail (auth, receipts, booking lifecycle) never
--                            consults this table — see services/notifications.ts.
--   * stock_notifications  — "email me when this is back" waitlist. Fulfilled by the hourly
--                            cron (services/notifications.ts:notifyBackInStock), which polls
--                            for variants that have crossed back above zero rather than
--                            hooking the ledger write — the same sweep pattern the booking
--                            reminders use.
--
-- Plus the second booking-reminder milestone (T-1h). 0016 shipped a single `reminder_sent_at`
-- stamp, so only one reminder could ever fire; `reminder_1h_sent_at` is the independent stamp
-- for the hour-before nudge. Both are cleared on reschedule alongside the existing column.
--
-- Idempotency-friendly: nullable columns, no destructive changes. Plain CREATE TABLE / CREATE
-- INDEX / ALTER TABLE only — no triggers (the test SQL splitter treats a trigger body's `;` as
-- a statement boundary).

-- ---------------------------------------------------------------------------
-- Web Push subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,       -- the push service URL; unique identity of a subscription
    p256dh TEXT NOT NULL,                -- client public key (base64url), for future payload encryption
    auth TEXT NOT NULL,                  -- client auth secret (base64url)
    user_agent TEXT,
    -- Consecutive delivery failures. A push service replies 404/410 when a subscription is dead;
    -- the sender bumps this and prunes the row once it has clearly gone away.
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subs_customer ON push_subscriptions(customer_id);

-- ---------------------------------------------------------------------------
-- Per-channel consent — OPTIONAL notifications only
--
-- One row per (customer, channel). Absence of a row means "use the channel's default":
-- marketing is opt-out (default off), transactional-adjacent nudges are opt-in (default on).
-- The resolver lives in services/notifications.ts so the default policy has one home.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_channel_consent (
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    -- 'marketing_email' | 'product_news' | 'back_in_stock' | 'push'
    channel TEXT NOT NULL,
    opted_in INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, channel)
);

-- ---------------------------------------------------------------------------
-- Back-in-stock waitlist
--
-- Keyed by email rather than customer_id so a logged-out shopper can still ask to be told.
-- customer_id is filled in opportunistically when the email matches a known account.
-- UNIQUE(variant_id, email): asking twice updates the existing row (see notify-me route),
-- so a customer is on the list once per variant and is notified once per restock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_notifications (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- NULL while waiting; stamped when the restock email goes out. A later re-subscribe
    -- (same variant + email) clears it back to NULL so the next restock notifies again.
    notified_at DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_notif_variant_email ON stock_notifications(variant_id, email);
-- The cron sweep selects on (notified_at IS NULL) joined to inventory.available_stock > 0.
CREATE INDEX IF NOT EXISTS idx_stock_notif_pending ON stock_notifications(notified_at, variant_id);

-- ---------------------------------------------------------------------------
-- Second booking-reminder milestone (T-1h)
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN reminder_1h_sent_at DATETIME;
