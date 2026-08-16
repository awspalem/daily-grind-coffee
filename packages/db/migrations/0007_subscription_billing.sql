-- Subscriptions were write-only: checkout created a row here on a Subscribe & Save order, but
-- nothing ever renewed it — one order, ever, no recurring charge. These columns capture the
-- Stripe customer + saved payment method from the initial checkout so a renewal cron can charge
-- off-session (see index.ts scheduled()); PAST_DUE covers subscriptions that can't be
-- auto-charged (no saved payment method, or the renewal charge failed/declined).
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_payment_method_id TEXT;
-- status also now takes 'PAST_DUE' alongside the existing ACTIVE/PAUSED/CANCELLED values.
