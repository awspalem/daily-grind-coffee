-- Migration 0015 — Subscription plans, tiers and terms (Phase 4).
--
-- Until now a subscription was frequency-only with a hardcoded 10% discount, created inline at
-- checkout. This adds a plan catalog (tier x term) that the subscription rows point at, the
-- columns self-serve management needs, and an event log for the customer-visible history.
--
-- IMPORTANT: `subscriptions` is declared with CREATE TABLE IF NOT EXISTS in BOTH 0001_init.sql
-- and 0007_subscription_billing.sql, so one of them silently no-opped on the live DB. Never add
-- a column by editing either CREATE — always ALTER TABLE here.
--
-- SQLite/D1 ALTER TABLE ADD COLUMN cannot take an expression default (CURRENT_TIMESTAMP), a
-- UNIQUE constraint, or NOT NULL without a constant default. Every column below respects that.

-- ==================== Plan catalog ====================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tier TEXT NOT NULL,                        -- EXPLORER, CONNOISSEUR, FOUNDER
    term TEXT NOT NULL,                        -- MONTHLY (charged per delivery cycle) or ANNUAL (prepaid)
    tagline TEXT,
    description TEXT,
    -- For MONTHLY this is indicative (the cron prices each cycle off the live variant price and
    -- discount_percent); for ANNUAL it is the amount actually charged up front.
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'inr',
    discount_percent INTEGER NOT NULL DEFAULT 10,
    default_frequency TEXT NOT NULL DEFAULT '2_WEEKS',   -- 1_WEEK, 2_WEEKS, 4_WEEKS
    -- ANNUAL plans prepay a fixed number of shipments; NULL for MONTHLY (open-ended).
    shipments_included INTEGER,
    term_months INTEGER NOT NULL DEFAULT 1,
    -- Human-readable selling points, JSON array of strings. Rendered on the storefront.
    perks_json TEXT NOT NULL DEFAULT '[]',
    -- Machine-readable grants issued on purchase and again on each renewal of the term:
    -- [{"code":"CONSULT_15MIN","units":2}]. units = -1 means unlimited for the term window.
    -- Consumed by Phase 5 bookings through services/entitlements.ts.
    entitlements_json TEXT NOT NULL DEFAULT '[]',
    badge TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_tier ON subscription_plans(tier, term);

-- ==================== Subscription columns ====================

ALTER TABLE subscriptions ADD COLUMN plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN plan_term TEXT;              -- MONTHLY | ANNUAL, denormalised from the plan
-- Start/end of the current paid term. An ANNUAL grant's validity window is exactly this span.
ALTER TABLE subscriptions ADD COLUMN term_started_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN term_ends_at DATETIME;
-- ANNUAL only: prepaid shipments left in the term. The renewal cron must NOT charge these
-- again, which is why prepaid rows sit in status PREPAID rather than ACTIVE (see below).
ALTER TABLE subscriptions ADD COLUMN shipments_remaining INTEGER;
ALTER TABLE subscriptions ADD COLUMN paused_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN cancelled_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN cancel_reason TEXT;
-- Set when a save-offer was accepted instead of cancelling, so it can only be taken once.
ALTER TABLE subscriptions ADD COLUMN save_offer_used_at DATETIME;
-- Marks the cycle a pre-billing notice has already gone out for, so the notice job is
-- idempotent and can never mail the same renewal twice.
ALTER TABLE subscriptions ADD COLUMN renewal_notice_sent_for DATETIME;

-- `status` gains PREPAID alongside ACTIVE / PAUSED / CANCELLED / PAST_DUE. PREPAID means the
-- term was paid up front: shipments are owed but no charge is due, and the renewal cron's
-- `WHERE status = 'ACTIVE'` deliberately skips these rows so a deploy can never double-bill an
-- annual member. Shipping them needs subscriptionPlans.processPrepaidShipments() wired into the
-- cron — tracked as a follow-up.

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);

-- ==================== Subscription event log ====================

-- Append-only history of everything that happened to a subscription, for the customer-facing
-- timeline and for staff support. Mirrors the inventory/entitlement ledger pattern.
CREATE TABLE IF NOT EXISTS subscription_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,        -- CREATED, PAUSED, RESUMED, SKIPPED, UPDATED, SWAPPED,
                                     -- CANCELLED, SAVE_OFFER_ACCEPTED, RENEWAL_NOTICE_SENT,
                                     -- PAYMENT_METHOD_UPDATED, ENTITLEMENTS_GRANTED
    actor TEXT NOT NULL DEFAULT 'CUSTOMER',  -- CUSTOMER, ADMIN, SYSTEM
    detail_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_sub ON subscription_events(subscription_id, created_at);

-- ==================== Seed catalog ====================
--
-- Three tiers, each in a monthly and a prepaid annual term. INR, priced in paise, against a
-- house 250g bag around Rs. 650-950. Annual prices are ~2 months' worth cheaper than paying the
-- monthly rate twelve times, which is what makes prepaying worth the commitment.

INSERT OR IGNORE INTO subscription_plans (
    id, slug, name, tier, term, tagline, description, price_cents, currency, discount_percent,
    default_frequency, shipments_included, term_months, perks_json, entitlements_json, badge,
    display_order, is_active
) VALUES
-- ---------- Explorer ----------
('plan_explorer_monthly', 'explorer-monthly', 'Explorer', 'EXPLORER', 'MONTHLY',
 'One bag, freshly roasted, every month',
 'The easy way in. A single 250g bag of our current house selection, roasted to order and shipped on your schedule. Change the coffee, the grind or the date whenever you like.',
 69900, 'inr', 10, '4_WEEKS', NULL, 1,
 '["10% off every bag","Free shipping on subscription deliveries","Change grind, coffee or date any time","Pause or skip a delivery whenever you need to"]',
 '[{"code":"FREE_SHIPPING","units":-1}]',
 NULL, 10, 1),

('plan_explorer_annual', 'explorer-annual', 'Explorer — Annual', 'EXPLORER', 'ANNUAL',
 'Twelve deliveries, prepaid, two months free',
 'A year of Explorer paid up front: twelve monthly bags at the price of ten, plus a seat at one of our Bangalore roastery tours.',
 699000, 'inr', 10, '4_WEEKS', 12, 12,
 '["Twelve deliveries for the price of ten","10% off every bag","Free shipping all year","1 roastery tour seat","Early access to limited-edition micro-lots"]',
 '[{"code":"FREE_SHIPPING","units":-1},{"code":"TOUR_SEAT","units":1},{"code":"EARLY_ACCESS","units":-1}]',
 'BEST VALUE', 11, 1),

-- ---------- Connoisseur ----------
('plan_connoisseur_monthly', 'connoisseur-monthly', 'Connoisseur', 'CONNOISSEUR', 'MONTHLY',
 'Two bags a month from the micro-lot shelf',
 'For the household that gets through more than a bag a month, and would rather drink the rare lots than the house blend. 15% off, priority on limited releases.',
 129900, 'inr', 15, '2_WEEKS', NULL, 1,
 '["15% off every bag","Free shipping on subscription deliveries","Early access to limited-edition micro-lots","Full self-serve control of grind, coffee, cadence and address"]',
 '[{"code":"FREE_SHIPPING","units":-1},{"code":"EARLY_ACCESS","units":-1}]',
 'MOST POPULAR', 20, 1),

('plan_connoisseur_annual', 'connoisseur-annual', 'Connoisseur — Annual', 'CONNOISSEUR', 'ANNUAL',
 'A year of micro-lots, plus time with our head roaster',
 'Twenty-six fortnightly deliveries paid up front, and the reason most people choose annual: two 15-minute video consultations with a Daily Roast barista to dial in your grinder, your water and your recipe.',
 1299000, 'inr', 15, '2_WEEKS', 26, 12,
 '["26 fortnightly deliveries for the price of 22","15% off every bag","Free shipping all year","2 x 15-minute barista teleconsultations","1 roastery tour seat","1 cupping table seat","Early access to limited-edition micro-lots"]',
 '[{"code":"FREE_SHIPPING","units":-1},{"code":"EARLY_ACCESS","units":-1},{"code":"CONSULT_15MIN","units":2},{"code":"TOUR_SEAT","units":1},{"code":"CUPPING_SEAT","units":1}]',
 'MOST POPULAR', 21, 1),

-- ---------- Founder ----------
('plan_founder_annual', 'founder-annual', 'Founder', 'FOUNDER', 'ANNUAL',
 'The whole roastery, for a year',
 'Our smallest, most involved tier. Everything in Connoisseur at 20% off, four teleconsultations, seats at the cupping table, and a place on the estate visit we run each harvest in the Western Ghats.',
 2499000, 'inr', 20, '2_WEEKS', 26, 12,
 '["26 fortnightly deliveries, weight of your choosing","20% off every bag and every add-on","Free shipping all year","4 x 15-minute barista teleconsultations","2 roastery tour seats","2 cupping table seats","1 place on the annual estate visit","First refusal on every limited-edition micro-lot"]',
 '[{"code":"FREE_SHIPPING","units":-1},{"code":"EARLY_ACCESS","units":-1},{"code":"CONSULT_15MIN","units":4},{"code":"TOUR_SEAT","units":2},{"code":"CUPPING_SEAT","units":2},{"code":"ESTATE_VISIT","units":1}]',
 'INVITATION TIER', 30, 1);
