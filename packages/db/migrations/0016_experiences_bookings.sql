-- Migration 0016 — Bookable experiences (Phase 5).
--
-- The four products the roadmap asks for — 15-minute barista teleconsultation, roastery tour,
-- cupping session, and multi-day estate visit — are ONE primitive, not four features: a slot with
-- capacity, a mode (VIDEO or ONSITE), a price or an entitlement that funds it, and a confirmation.
-- Everything that differs between them is a column value, not a table.
--
-- Stacks on 0011 (entitlement_grants / entitlement_ledger): plans GRANT, bookings CONSUME.
-- Per the Phase 0 note, nothing here edits an already-applied CREATE TABLE.
--
-- TIME: every DATETIME in these tables is a UTC ISO-8601 string. The roastery operates in
-- Asia/Kolkata; that conversion happens at the presentation edge (storefront, admin, email) and
-- never in the database, so a slot can never mean two different instants.

-- ---------------------------------------------------------------------------
-- 5.1 Experience catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tagline TEXT,
    description TEXT,

    -- TELECONSULT | ROASTERY_TOUR | CUPPING_SESSION | ESTATE_VISIT
    experience_type TEXT NOT NULL,
    -- VIDEO (meeting link carried on the slot) | ONSITE (physical location)
    mode TEXT NOT NULL DEFAULT 'ONSITE',

    duration_minutes INTEGER,            -- NULL for multi-day; the slot's range is authoritative
    is_multi_day INTEGER NOT NULL DEFAULT 0,

    default_capacity INTEGER NOT NULL DEFAULT 1,
    price_cents INTEGER NOT NULL DEFAULT 0,
    deposit_cents INTEGER NOT NULL DEFAULT 0,   -- charged up front for estate visits (5.6)
    currency TEXT NOT NULL DEFAULT 'inr',

    -- The 0011 entitlement code that can fund this instead of payment. NULL = always paid.
    entitlement_code TEXT,

    -- 5.5 cancellation policy. Self-serve cancel/reschedule is allowed until this many hours
    -- before the slot starts; after that the customer must contact support.
    cancellation_cutoff_hours INTEGER NOT NULL DEFAULT 24,
    cancellation_policy TEXT,
    refund_on_cancel INTEGER NOT NULL DEFAULT 1,  -- 0 = deposit is non-refundable

    location_name TEXT,
    location_address TEXT,
    display_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',

    -- 5.6: estate visits book a party, collect dietary/accessibility notes, and take a deposit.
    collects_party_size INTEGER NOT NULL DEFAULT 0,
    max_party_size INTEGER NOT NULL DEFAULT 1,
    collects_notes INTEGER NOT NULL DEFAULT 0,

    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | DRAFT | ARCHIVED

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_experiences_status ON experiences(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_experiences_type ON experiences(experience_type);

-- ---------------------------------------------------------------------------
-- 5.2 Slots & capacity
-- ---------------------------------------------------------------------------
-- `seats_booked` is the single authority on capacity. It is never written by a plain
-- read-then-write: every mutation carries the predicate `seats_booked + n <= seats_total` inside
-- the statement itself, in the same D1 batch as the booking row, so overbooking is structurally
-- impossible rather than merely unlikely. See services/bookings.ts.
CREATE TABLE IF NOT EXISTS experience_slots (
    id TEXT PRIMARY KEY,
    experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,

    starts_at DATETIME NOT NULL,         -- UTC ISO
    ends_at DATETIME NOT NULL,           -- UTC ISO; spans days for an estate visit

    seats_total INTEGER NOT NULL,
    seats_booked INTEGER NOT NULL DEFAULT 0,

    staff_name TEXT,
    staff_email TEXT,

    meeting_url TEXT,                    -- VIDEO mode: the video-room link for this session
    location_override TEXT,              -- ONSITE mode: a one-off venue for this slot

    price_cents_override INTEGER,        -- seasonal pricing without editing the catalog row
    status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED | CANCELLED | COMPLETED
    notes TEXT,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (seats_booked >= 0),
    CHECK (seats_booked <= seats_total)
);

CREATE INDEX IF NOT EXISTS idx_exp_slots_experience ON experience_slots(experience_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_exp_slots_upcoming ON experience_slots(status, starts_at);

-- Blackout windows: holidays, maintenance, a roaster on leave. A NULL experience_id blacks the
-- window out for every experience. Availability queries exclude any slot overlapping one of these,
-- which is cheaper than deleting and re-creating slots around each closure.
CREATE TABLE IF NOT EXISTS experience_blackouts (
    id TEXT PRIMARY KEY,
    experience_id TEXT REFERENCES experiences(id) ON DELETE CASCADE,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exp_blackouts_window ON experience_blackouts(starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- 5.3 Bookings (the waitlist lives here too — a waitlisted row is a booking holding zero seats)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    booking_reference TEXT NOT NULL UNIQUE,   -- human-quotable, e.g. TDR-B-7Q2K4M

    experience_id TEXT NOT NULL REFERENCES experiences(id),
    slot_id TEXT NOT NULL REFERENCES experience_slots(id),
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    customer_email TEXT NOT NULL,
    customer_name TEXT,
    contact_phone TEXT,

    -- HOLD             seats reserved, not yet funded (expires at hold_expires_at)
    -- PENDING_PAYMENT  Stripe session open, seats still held
    -- CONFIRMED        funded and locked in
    -- WAITLISTED       slot was full; holds NO seats
    -- WAITLIST_OFFERED a seat opened and is held for this customer until hold_expires_at
    -- CANCELLED | EXPIRED | COMPLETED | NO_SHOW
    status TEXT NOT NULL DEFAULT 'HOLD',

    -- `seats` is what capacity is charged for. For VIDEO it is always 1; for ONSITE it equals
    -- party_size. Both columns exist for readability but are written from one number, so they
    -- can never drift apart.
    seats INTEGER NOT NULL DEFAULT 1,
    party_size INTEGER NOT NULL DEFAULT 1,

    -- PAID | ENTITLEMENT | FREE — decided at confirm time, not at hold time.
    funding_source TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    deposit_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'inr',

    -- Which 0011 code funded it. The per-grant unit split is NOT duplicated here: it lives in
    -- entitlement_ledger (ref_type='BOOKING', ref_id=bookings.id). A cancellation reads that
    -- ledger back, so it restores exactly what was spent even when a multi-seat booking drew
    -- from two grants at different rates.
    entitlement_code TEXT,

    stripe_session_id TEXT,
    stripe_payment_intent_id TEXT,
    payment_status TEXT,                 -- UNPAID | PAID | REFUND_PENDING | REFUNDED | REFUND_FAILED

    -- 5.6 free-text, customer-supplied. Treated as hostile everywhere it is rendered.
    dietary_notes TEXT,
    accessibility_notes TEXT,

    hold_expires_at DATETIME,
    confirmed_at DATETIME,
    cancelled_at DATETIME,
    cancellation_reason TEXT,
    rescheduled_from_slot_id TEXT,
    reschedule_count INTEGER NOT NULL DEFAULT 0,

    attended_at DATETIME,
    no_show_at DATETIME,
    staff_notes TEXT,

    confirmation_sent_at DATETIME,
    reminder_sent_at DATETIME,           -- T-24h reminder; the NULL check makes the sweep idempotent

    -- Unguessable, so the .ics can be fetched by a mail client that carries no session header.
    ics_token TEXT NOT NULL,

    -- A double-tapped "Book" from the same client reuses this row instead of taking a second seat.
    idempotency_key TEXT UNIQUE,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_reminder ON bookings(status, reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ics ON bookings(ics_token);

-- ---------------------------------------------------------------------------
-- Seed: the four experiences. Slots are staff-created in the admin portal, so none are seeded
-- here — an experience with no slots simply reads "dates coming soon" on the storefront.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO experiences (
    id, slug, name, tagline, description, experience_type, mode,
    duration_minutes, is_multi_day, default_capacity, price_cents, deposit_cents, currency,
    entitlement_code, cancellation_cutoff_hours, cancellation_policy, refund_on_cancel,
    location_name, location_address, collects_party_size, max_party_size, collects_notes,
    sort_order, status
) VALUES
(
    'exp_consult_15', 'barista-teleconsultation',
    '15-Minute Barista Teleconsultation',
    'One roaster, your grinder, fifteen focused minutes.',
    'A live video call with one of our roasters. Bring your grinder, your brewer and the bag you are struggling with, and we will dial it in together — grind setting, ratio, water, timing. Annual subscribers have these included.',
    'TELECONSULT', 'VIDEO',
    15, 0, 1, 90000, 0, 'inr',
    'CONSULT_15MIN', 12,
    'Free to reschedule or cancel up to 12 hours before the call. Inside 12 hours the credit is spent.', 1,
    NULL, NULL, 0, 1, 0,
    1, 'ACTIVE'
),
(
    'exp_tour_roastery', 'roastery-tour',
    'Roastery Tour',
    'Green bean to first crack, with the drum running.',
    'Ninety minutes on the roastery floor: the green store, the sample roaster, a live production roast on the drum, and the cooling tray. Ends with a cup of whatever came off the roaster that morning.',
    'ROASTERY_TOUR', 'ONSITE',
    90, 0, 12, 150000, 0, 'inr',
    'TOUR_SEAT', 24,
    'Free to reschedule or cancel up to 24 hours before the tour. Inside 24 hours the seat is non-refundable.', 1,
    'The Daily Roast Roastery', 'Survey 42, Coffee Board Road, Bengaluru 560001', 1, 6, 0,
    2, 'ACTIVE'
),
(
    'exp_cupping', 'cupping-session',
    'Cupping Session',
    'Six origins, one table, no wrong answers.',
    'A guided cupping across six single origins on the table at once. You will break the crust, slurp loudly, and leave able to tell a washed Ethiopian from a natural one with your eyes shut.',
    'CUPPING_SESSION', 'ONSITE',
    75, 0, 10, 120000, 0, 'inr',
    'CUPPING_SEAT', 24,
    'Free to reschedule or cancel up to 24 hours before the session. Inside 24 hours the seat is non-refundable.', 1,
    'The Daily Roast Cupping Lab', 'Survey 42, Coffee Board Road, Bengaluru 560001', 1, 4, 1,
    3, 'ACTIVE'
),
(
    'exp_estate_visit', 'estate-tour-and-visit',
    'Estate Tour & Visit',
    'Three days at origin, in the Chikmagalur hills.',
    'A three-day stay on the estate we buy from: the cherry picking line, the wet mill and the drying beds, a walk under the shade canopy, and long dinners with the growers. Travel to Chikmagalur is not included; we will help you arrange it.',
    'ESTATE_VISIT', 'ONSITE',
    NULL, 1, 8, 4500000, 1000000, 'inr',
    'ESTATE_VISIT', 168,
    'A deposit secures your place. Free to cancel up to 7 days before arrival with a full deposit refund; inside 7 days the deposit is retained.', 1,
    'Kelagur Estate, Chikmagalur', 'Kelagur Estate, Chikmagalur District, Karnataka 577101', 1, 8, 1,
    4, 'ACTIVE'
);
