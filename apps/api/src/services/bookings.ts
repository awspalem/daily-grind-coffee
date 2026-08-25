import type { Env } from '../types/env';
import { consumeEntitlement, releaseEntitlement, hasEntitlement } from './entitlements';
import { ResendEmailService } from './resend';
import { StripeService } from './stripe';

/**
 * Bookable experiences — the Phase 5 engine.
 *
 * One primitive serves all four products: a slot with capacity, a mode, a price OR an entitlement
 * that funds it, and a confirmation. The teleconsultation is simply the `mode = 'VIDEO'` case.
 *
 * Two invariants this file exists to protect:
 *
 *  1. Overbooking is structurally impossible. Capacity is never read, decided upon, and then
 *     written — the `seats_booked + n <= seats_total` predicate travels *inside* every statement
 *     that touches capacity, and the booking row and the seat count move in the same D1 batch.
 *     This is stronger than the read-then-write in services/inventoryLedger.ts, which can lose a
 *     race between its SELECT and its batch.
 *
 *  2. A double-tapped "Confirm" can never burn two consultation credits. Every consume carries an
 *     idempotency key derived from the booking id, which the 0011 ledger enforces as UNIQUE.
 *
 * TIME: the database stores UTC ISO-8601 throughout. Every human-facing string produced here is
 * rendered in Asia/Kolkata and labelled IST, so a customer and a roaster never read a slot as two
 * different instants.
 */

export const ROASTERY_TIMEZONE = 'Asia/Kolkata';

/** How long an unfunded hold keeps a seat before the sweep takes it back. */
const HOLD_MINUTES = 15;
/** How long a waitlisted customer gets to claim a seat that opened up. */
const WAITLIST_OFFER_HOURS = 24;
/** A Stripe session left unfinished this long is reconciled or released. */
const PENDING_PAYMENT_MINUTES = 60;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/** Human-quotable reference. Avoids I/O/0/1 so it survives being read down a phone line. */
function newBookingReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `TDR-B-${out}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** D1 reports affected rows in `meta.changes`; the shared type widens it to unknown. */
function changesOf(result: { meta?: Record<string, unknown> } | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

/**
 * SQLite stores our timestamps as UTC but CURRENT_TIMESTAMP writes them without a `Z`. Normalising
 * on read is what stops a slot drifting by the 5h30m of IST offset when it round-trips.
 */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(normalised);
  return isNaN(d.getTime()) ? null : d;
}

/** e.g. "Sat, 14 Mar 2026, 10:30 AM IST" */
export function formatInRoasteryTime(value: string | null | undefined, timeZone = ROASTERY_TIMEZONE): string {
  const d = toDate(value);
  if (!d) return '';
  const formatted = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(d);
  return `${formatted} IST`;
}

/** Date only — an estate visit spans days, so the clock time is noise. */
export function formatDateInRoasteryTime(value: string | null | undefined, timeZone = ROASTERY_TIMEZONE): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone,
  }).format(d);
}

export function formatMoney(cents: number, currency = 'inr'): string {
  const code = (currency || 'inr').toUpperCase();
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency: code, maximumFractionDigits: 0,
    }).format((cents || 0) / 100);
  } catch {
    return `${code} ${((cents || 0) / 100).toFixed(2)}`;
  }
}

/** Escapes text bound for an HTML email body. Dietary notes are customer-supplied free text. */
function escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  experience_type: string;
  mode: string;
  duration_minutes: number | null;
  is_multi_day: number;
  default_capacity: number;
  price_cents: number;
  deposit_cents: number;
  currency: string;
  entitlement_code: string | null;
  cancellation_cutoff_hours: number;
  cancellation_policy: string | null;
  refund_on_cancel: number;
  location_name: string | null;
  location_address: string | null;
  display_timezone: string;
  collects_party_size: number;
  max_party_size: number;
  collects_notes: number;
  image_url: string | null;
  sort_order: number;
  status: string;
}

export interface SlotRow {
  id: string;
  experience_id: string;
  starts_at: string;
  ends_at: string;
  seats_total: number;
  seats_booked: number;
  staff_name: string | null;
  staff_email: string | null;
  meeting_url: string | null;
  location_override: string | null;
  price_cents_override: number | null;
  status: string;
  notes: string | null;
}

export interface BookingRow {
  id: string;
  booking_reference: string;
  experience_id: string;
  slot_id: string;
  customer_id: string;
  customer_email: string;
  customer_name: string | null;
  contact_phone: string | null;
  status: string;
  seats: number;
  party_size: number;
  funding_source: string | null;
  amount_cents: number;
  deposit_cents: number;
  currency: string;
  entitlement_code: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_status: string | null;
  dietary_notes: string | null;
  accessibility_notes: string | null;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  rescheduled_from_slot_id: string | null;
  reschedule_count: number;
  attended_at: string | null;
  no_show_at: string | null;
  staff_notes: string | null;
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
  ics_token: string;
}

/** A booking joined to its experience and slot — what every customer-facing response returns. */
export interface BookingDetailRow extends BookingRow {
  experience_name: string;
  experience_slug: string;
  experience_type: string;
  mode: string;
  display_timezone: string;
  cancellation_policy: string | null;
  cancellation_cutoff_hours: number;
  refund_on_cancel: number;
  is_multi_day: number;
  starts_at: string;
  ends_at: string;
  staff_name: string | null;
  location: string | null;
  meeting_url: string | null;
}

const BOOKING_DETAIL_SQL = `
  SELECT b.*,
         e.name AS experience_name,
         e.slug AS experience_slug,
         e.experience_type,
         e.mode,
         e.display_timezone,
         e.cancellation_policy,
         e.cancellation_cutoff_hours,
         e.refund_on_cancel,
         e.is_multi_day,
         s.starts_at,
         s.ends_at,
         s.staff_name,
         COALESCE(s.location_override, e.location_address, e.location_name) AS location,
         s.meeting_url
  FROM bookings b
  JOIN experiences e ON e.id = b.experience_id
  JOIN experience_slots s ON s.id = b.slot_id
`;

/** Statuses that are still holding a seat against the slot's capacity. */
const SEAT_HOLDING_STATUSES = ['HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'WAITLIST_OFFERED', 'COMPLETED', 'NO_SHOW'];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getExperience(db: Env['DB'], slugOrId: string): Promise<ExperienceRow | null> {
  return db
    .prepare('SELECT * FROM experiences WHERE (slug = ? OR id = ?) LIMIT 1')
    .bind(slugOrId, slugOrId)
    .first<ExperienceRow>();
}

export async function listExperiences(db: Env['DB'], includeInactive = false): Promise<ExperienceRow[]> {
  const sql = includeInactive
    ? 'SELECT * FROM experiences ORDER BY sort_order ASC, name ASC'
    : "SELECT * FROM experiences WHERE status = 'ACTIVE' ORDER BY sort_order ASC, name ASC";
  const { results } = await db.prepare(sql).all<ExperienceRow>();
  return results || [];
}

/**
 * Bookable slots for an experience. Excludes anything in the past, anything not OPEN, and anything
 * overlapping a blackout window — a blackout suppresses slots rather than deleting them, so the
 * closure can be lifted without re-creating the schedule.
 */
export async function listAvailableSlots(
  db: Env['DB'],
  experienceId: string,
  opts: { from?: string; to?: string; includePast?: boolean } = {}
): Promise<SlotRow[]> {
  const clauses = ['s.experience_id = ?', "s.status = 'OPEN'"];
  const params: unknown[] = [experienceId];

  if (!opts.includePast) {
    clauses.push('s.starts_at > ?');
    params.push(nowIso());
  }
  if (opts.from) { clauses.push('s.starts_at >= ?'); params.push(opts.from); }
  if (opts.to) { clauses.push('s.starts_at <= ?'); params.push(opts.to); }

  const sql = `
    SELECT s.* FROM experience_slots s
    WHERE ${clauses.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1 FROM experience_blackouts bo
        WHERE (bo.experience_id IS NULL OR bo.experience_id = s.experience_id)
          AND bo.starts_at < s.ends_at
          AND bo.ends_at > s.starts_at
      )
    ORDER BY s.starts_at ASC
    LIMIT 200
  `;
  const { results } = await db.prepare(sql).bind(...params).all<SlotRow>();
  return results || [];
}

export async function getBookingDetail(db: Env['DB'], bookingId: string): Promise<BookingDetailRow | null> {
  return db.prepare(`${BOOKING_DETAIL_SQL} WHERE b.id = ?`).bind(bookingId).first<BookingDetailRow>();
}

export async function listCustomerBookings(db: Env['DB'], customerId: string): Promise<BookingDetailRow[]> {
  const { results } = await db
    .prepare(`${BOOKING_DETAIL_SQL} WHERE b.customer_id = ? ORDER BY s.starts_at DESC LIMIT 100`)
    .bind(customerId)
    .all<BookingDetailRow>();
  return results || [];
}

/** Price for one seat on this slot — the slot override wins over the catalog price. */
export function seatPriceCents(experience: ExperienceRow, slot: SlotRow): number {
  return slot.price_cents_override ?? experience.price_cents;
}

/** True while self-serve cancel/reschedule is still inside the experience's policy window. */
export function withinCancellationWindow(startsAt: string, cutoffHours: number): boolean {
  const start = toDate(startsAt);
  if (!start) return false;
  return start.getTime() - Date.now() > cutoffHours * 3600_000;
}

// ---------------------------------------------------------------------------
// 5.2/5.3 — Holding a seat
// ---------------------------------------------------------------------------

export interface CreateBookingInput {
  experience: ExperienceRow;
  slot: SlotRow;
  customerId: string;
  customerEmail: string;
  customerName?: string | null;
  contactPhone?: string | null;
  partySize?: number;
  dietaryNotes?: string | null;
  accessibilityNotes?: string | null;
  idempotencyKey?: string | null;
}

export interface CreateBookingResult {
  success: boolean;
  error?: string;
  booking?: BookingDetailRow;
  waitlisted?: boolean;
  /** True when an identical request had already created this booking. */
  reused?: boolean;
}

/**
 * Places a hold, or joins the waitlist when the slot is full.
 *
 * The atomicity argument, because it is the whole point of this function:
 *
 *   statement 1  INSERT INTO bookings ... SELECT ... FROM experience_slots s
 *                WHERE s.id = ? AND s.status = 'OPEN' AND s.seats_booked + n <= s.seats_total
 *   statement 2  UPDATE experience_slots SET seats_booked = seats_booked + n
 *                WHERE id = ? AND status = 'OPEN' AND seats_booked + n <= seats_total
 *
 * Statement 1 writes only `bookings`, so when statement 2 evaluates its predicate it still sees
 * the same `experience_slots` row that statement 1 saw. The two predicates are identical, so both
 * statements apply or neither does — there is no state in which a booking row exists without its
 * seat, or a seat is taken without a booking. D1 runs a batch as one transaction, and SQLite
 * serialises writers, so a concurrent booking either loses the predicate and falls to the
 * waitlist, or is serialised behind this one.
 *
 * NOTE: never insert a statement between these two that touches `experience_slots` — that would
 * break the shared-predicate argument and reintroduce the race.
 */
export async function createBooking(db: Env['DB'], input: CreateBookingInput): Promise<CreateBookingResult> {
  const { experience, slot, customerId } = input;

  if (slot.status !== 'OPEN') return { success: false, error: 'That slot is no longer open for booking.' };
  if ((toDate(slot.starts_at)?.getTime() ?? 0) <= Date.now()) {
    return { success: false, error: 'That slot has already started.' };
  }

  // Party size is the seat count for an onsite experience; a video call is always one person.
  const requested = experience.mode === 'VIDEO'
    ? 1
    : Math.max(1, Math.min(Number(input.partySize) || 1, experience.max_party_size || 1));

  if (input.idempotencyKey) {
    const existing = await db
      .prepare('SELECT id FROM bookings WHERE idempotency_key = ?')
      .bind(input.idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      const booking = await getBookingDetail(db, existing.id);
      return { success: true, booking: booking ?? undefined, reused: true, waitlisted: booking?.status === 'WAITLISTED' };
    }
  }

  const bookingId = newId('bk');
  const reference = newBookingReference();
  const icsToken = crypto.randomUUID().replace(/-/g, '');
  const amountCents = seatPriceCents(experience, slot) * requested;
  const depositCents = experience.deposit_cents * requested;
  const holdExpiresAt = isoIn(HOLD_MINUTES * 60_000);
  const key = input.idempotencyKey || `auto_${bookingId}`;

  const insertHeld = db.prepare(`
    INSERT INTO bookings (
      id, booking_reference, experience_id, slot_id, customer_id, customer_email, customer_name,
      contact_phone, status, seats, party_size, amount_cents, deposit_cents, currency,
      entitlement_code, payment_status, dietary_notes, accessibility_notes, hold_expires_at,
      ics_token, idempotency_key
    )
    SELECT ?, ?, ?, s.id, ?, ?, ?, ?, 'HOLD', ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?
    FROM experience_slots s
    WHERE s.id = ?
      AND s.status = 'OPEN'
      AND s.seats_booked + ? <= s.seats_total
  `).bind(
    bookingId, reference, experience.id, customerId, input.customerEmail, input.customerName ?? null,
    input.contactPhone ?? null, requested, requested, amountCents, depositCents, experience.currency,
    experience.entitlement_code, input.dietaryNotes ?? null, input.accessibilityNotes ?? null,
    holdExpiresAt, icsToken, key,
    slot.id, requested
  );

  const takeSeats = db.prepare(`
    UPDATE experience_slots
    SET seats_booked = seats_booked + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'OPEN' AND seats_booked + ? <= seats_total
  `).bind(requested, slot.id, requested);

  const [insertResult] = await db.batch([insertHeld, takeSeats]);

  if (changesOf(insertResult) > 0) {
    const booking = await getBookingDetail(db, bookingId);
    return { success: true, booking: booking ?? undefined, waitlisted: false };
  }

  // The predicate failed: the slot filled up between the customer loading the page and tapping
  // Book. Fall through to the waitlist rather than erroring — a waitlisted booking holds no seat,
  // so it needs no capacity guard.
  return createWaitlistEntry(db, { ...input, seats: requested, amountCents, depositCents });
}

async function createWaitlistEntry(
  db: Env['DB'],
  input: CreateBookingInput & { seats: number; amountCents: number; depositCents: number }
): Promise<CreateBookingResult> {
  const { experience, slot } = input;

  const alreadyWaiting = await db
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND customer_id = ? AND status IN ('WAITLISTED','WAITLIST_OFFERED')")
    .bind(slot.id, input.customerId)
    .first<{ id: string }>();
  if (alreadyWaiting) {
    const booking = await getBookingDetail(db, alreadyWaiting.id);
    return { success: true, booking: booking ?? undefined, waitlisted: true, reused: true };
  }

  const bookingId = newId('bk');
  await db.prepare(`
    INSERT INTO bookings (
      id, booking_reference, experience_id, slot_id, customer_id, customer_email, customer_name,
      contact_phone, status, seats, party_size, amount_cents, deposit_cents, currency,
      entitlement_code, payment_status, dietary_notes, accessibility_notes, ics_token, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'WAITLISTED', ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?)
  `).bind(
    bookingId, newBookingReference(), experience.id, slot.id, input.customerId, input.customerEmail,
    input.customerName ?? null, input.contactPhone ?? null, input.seats, input.seats,
    input.amountCents, input.depositCents, experience.currency, experience.entitlement_code,
    input.dietaryNotes ?? null, input.accessibilityNotes ?? null,
    crypto.randomUUID().replace(/-/g, ''), input.idempotencyKey || `auto_${bookingId}`
  ).run();

  const booking = await getBookingDetail(db, bookingId);
  return { success: true, booking: booking ?? undefined, waitlisted: true };
}

// ---------------------------------------------------------------------------
// 5.3 — Funding a hold: entitlement first, payment second
// ---------------------------------------------------------------------------

export interface ConfirmResult {
  success: boolean;
  error?: string;
  booking?: BookingDetailRow;
  checkoutUrl?: string;
  fundingSource?: 'PAID' | 'ENTITLEMENT' | 'FREE';
}

/**
 * Turns a hold into a confirmed booking.
 *
 * Entitlement path: `consumeEntitlement` spends `seats` units of the experience's code under an
 * idempotency key derived from the booking id, so however many times Confirm is tapped, at most
 * one credit per seat is ever burnt. It returns `{ success: false }` rather than throwing when the
 * balance is short, which is exactly the signal to fall through to the paid path.
 *
 * Paid path: this route creates its own Stripe Checkout Session — routes/checkout.ts belongs to
 * another feature and knows nothing about bookings. The seat stays held while the session is open;
 * `reconcilePendingPayments` closes the loop for customers who never come back from Stripe.
 */
export async function confirmBooking(
  env: Env,
  booking: BookingDetailRow,
  opts: { preferred?: 'PAID' | 'ENTITLEMENT' } = {}
): Promise<ConfirmResult> {
  const db = env.DB;

  if (booking.status === 'CONFIRMED') {
    return { success: true, booking, fundingSource: (booking.funding_source as any) || undefined };
  }
  if (!['HOLD', 'PENDING_PAYMENT', 'WAITLIST_OFFERED'].includes(booking.status)) {
    return { success: false, error: `This booking cannot be confirmed (status ${booking.status}).` };
  }
  if ((toDate(booking.starts_at)?.getTime() ?? 0) <= Date.now()) {
    return { success: false, error: 'That slot has already started.' };
  }

  const totalDue = booking.amount_cents;

  // Free experience — nothing to fund.
  if (totalDue <= 0 && booking.deposit_cents <= 0) {
    return finaliseConfirmation(env, booking, 'FREE');
  }

  const code = booking.entitlement_code;
  const wantsEntitlement = opts.preferred !== 'PAID';

  if (wantsEntitlement && code) {
    const affordable = await hasEntitlement(db, booking.customer_id, code, booking.seats);
    if (affordable) {
      const consumed = await consumeEntitlement(db, {
        customerId: booking.customer_id,
        code,
        units: booking.seats,
        reason: 'BOOKING_CONFIRMED',
        refType: 'BOOKING',
        refId: booking.id,
        // Derived from the booking, so a retried Confirm reports the original spend rather than
        // taking a second credit.
        idempotencyKey: `booking:${booking.id}:consume`,
      });
      if (consumed.success) {
        return finaliseConfirmation(env, booking, 'ENTITLEMENT');
      }
      // Balance evaporated between the check and the spend — fall through and charge instead.
      console.warn(`[bookings] entitlement ${code} unavailable for ${booking.id}: ${consumed.error}`);
    }
  }

  // Paid path.
  const chargeCents = booking.deposit_cents > 0 ? booking.deposit_cents : totalDue;
  if (chargeCents <= 0) return finaliseConfirmation(env, booking, 'FREE');

  const stripe = new StripeService(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  const storefront = env.STOREFRONT_URL || 'https://dailyroast.in';
  const label = booking.deposit_cents > 0
    ? `${booking.experience_name} — deposit`
    : booking.experience_name;

  let session: { id: string; url: string };
  try {
    session = await stripe.createCheckoutSession({
      // The booking stands in for an order here; nothing downstream of Stripe reads these back
      // except our own settle call, which looks the booking up by id.
      orderId: booking.id,
      orderNumber: booking.booking_reference,
      customerEmail: booking.customer_email,
      items: [{
        name: label,
        description: `${formatInRoasteryTime(booking.starts_at, booking.display_timezone)} · ${booking.seats} ${booking.seats === 1 ? 'place' : 'places'}`,
        unitPriceCents: Math.round(chargeCents / booking.seats),
        quantity: booking.seats,
      }],
      shippingCents: 0,
      currency: booking.currency || env.CURRENCY || 'inr',
      successUrl: `${storefront}/?booking_settle=${booking.id}`,
      cancelUrl: `${storefront}/?booking_cancelled=${booking.id}#experiences`,
    });
  } catch (err: any) {
    console.error('[bookings] Stripe session creation failed', err);
    return { success: false, error: 'Could not start payment. Please try again.' };
  }

  await db.prepare(`
    UPDATE bookings
    SET status = 'PENDING_PAYMENT', funding_source = 'PAID', stripe_session_id = ?,
        payment_status = 'UNPAID', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(session.id, booking.id).run();

  const updated = await getBookingDetail(db, booking.id);
  return { success: true, booking: updated ?? booking, checkoutUrl: session.url, fundingSource: 'PAID' };
}

/** Marks the booking CONFIRMED and sends the confirmation email. Shared by every funding path. */
async function finaliseConfirmation(
  env: Env,
  booking: BookingDetailRow,
  fundingSource: 'PAID' | 'ENTITLEMENT' | 'FREE'
): Promise<ConfirmResult> {
  await env.DB.prepare(`
    UPDATE bookings
    SET status = 'CONFIRMED', funding_source = ?, confirmed_at = CURRENT_TIMESTAMP,
        hold_expires_at = NULL, payment_status = CASE WHEN ? = 'PAID' THEN 'PAID' ELSE payment_status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(fundingSource, fundingSource, booking.id).run();

  const updated = await getBookingDetail(env.DB, booking.id);
  if (updated) await sendConfirmationEmail(env, updated);
  return { success: true, booking: updated ?? booking, fundingSource };
}

/**
 * Verifies a Stripe Checkout Session and confirms the booking if it was paid. Called both by the
 * storefront when the customer returns from Stripe and by the reconcile sweep for the ones who
 * never do — routes/webhooks.ts belongs to another feature, so bookings cannot rely on it.
 */
export async function settleBookingPayment(env: Env, booking: BookingDetailRow): Promise<ConfirmResult> {
  if (booking.status === 'CONFIRMED') return { success: true, booking, fundingSource: 'PAID' };
  if (!booking.stripe_session_id) return { success: false, error: 'No payment session for this booking.' };

  const paid = await fetchSessionPaymentState(env, booking.stripe_session_id);
  if (!paid.paid) {
    return { success: false, error: paid.error || 'Payment has not completed yet.' };
  }

  if (paid.paymentIntentId) {
    await env.DB.prepare('UPDATE bookings SET stripe_payment_intent_id = ? WHERE id = ?')
      .bind(paid.paymentIntentId, booking.id).run();
  }
  return finaliseConfirmation(env, booking, 'PAID');
}

/**
 * Reads a Checkout Session's payment state straight from Stripe. Kept here rather than added to
 * services/stripe.ts, which is shared with the checkout feature. Mock keys short-circuit the same
 * way StripeService does, so the flow is exercisable end to end without live credentials.
 */
async function fetchSessionPaymentState(
  env: Env,
  sessionId: string
): Promise<{ paid: boolean; paymentIntentId?: string; error?: string }> {
  const key = env.STRIPE_SECRET_KEY;
  const isMock = !key || key.startsWith('sk_test_mock') || key === 'placeholder' || sessionId.startsWith('cs_mock_');
  if (isMock) return { paid: true, paymentIntentId: 'pi_mock_' + sessionId.slice(-16) };

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { paid: false, error: 'Could not verify payment with Stripe.' };
    const data = await res.json() as { payment_status?: string; payment_intent?: string | { id?: string } };
    const intent = typeof data.payment_intent === 'string' ? data.payment_intent : data.payment_intent?.id;
    return { paid: data.payment_status === 'paid', paymentIntentId: intent || undefined };
  } catch (err: any) {
    console.error('[bookings] Stripe session lookup failed', err);
    return { paid: false, error: 'Could not verify payment with Stripe.' };
  }
}

// ---------------------------------------------------------------------------
// 5.5 — Cancel, reschedule, no-show
// ---------------------------------------------------------------------------

export interface CancelResult {
  success: boolean;
  error?: string;
  booking?: BookingDetailRow;
  entitlementRestored?: boolean;
  refundStatus?: string;
}

/**
 * Cancels a booking, releases its seat, and undoes the funding: entitlement units go back via
 * `releaseEntitlement`, a card payment is refunded.
 *
 * The restore reads `entitlement_ledger` rather than a column on the booking, because a multi-seat
 * booking can draw across two grants at an uneven split — three cupping seats might take two units
 * from a grant expiring in March and one from a grant expiring in June. Only the ledger records
 * which grant gave up how many, so only the ledger can put them back where they came from.
 */
export async function cancelBooking(
  env: Env,
  booking: BookingDetailRow,
  opts: { reason?: string; byStaff?: boolean } = {}
): Promise<CancelResult> {
  const db = env.DB;

  if (['CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW'].includes(booking.status)) {
    return { success: false, error: 'This booking is already closed.' };
  }
  if (!opts.byStaff && !withinCancellationWindow(booking.starts_at, booking.cancellation_cutoff_hours)) {
    return {
      success: false,
      error: `Free cancellation closed ${booking.cancellation_cutoff_hours} hours before the start time. Please contact support@dailyroast.in.`,
    };
  }

  const heldSeat = SEAT_HOLDING_STATUSES.includes(booking.status);

  await db.prepare(`
    UPDATE bookings
    SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ?,
        hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(opts.reason ?? (opts.byStaff ? 'Cancelled by staff' : 'Cancelled by customer'), booking.id).run();

  if (heldSeat) await releaseSeats(db, booking.slot_id, booking.seats);

  let entitlementRestored = false;
  let refundStatus: string | undefined;

  if (booking.funding_source === 'ENTITLEMENT') {
    entitlementRestored = await restoreEntitlementForBooking(db, booking);
  } else if (booking.funding_source === 'PAID' && booking.payment_status === 'PAID') {
    refundStatus = booking.refund_on_cancel
      ? await refundBookingPayment(env, booking)
      : 'NOT_REFUNDABLE';
  }

  if (heldSeat) await promoteFromWaitlist(env, booking.slot_id);

  const updated = await getBookingDetail(db, booking.id);
  if (updated) await sendCancellationEmail(env, updated, { entitlementRestored, refundStatus });

  return { success: true, booking: updated ?? undefined, entitlementRestored, refundStatus };
}

/** Puts every unit this booking spent back on the exact grant it came from. */
async function restoreEntitlementForBooking(db: Env['DB'], booking: BookingRow): Promise<boolean> {
  const { results } = await db.prepare(`
    SELECT grant_id, entitlement_code, delta_units
    FROM entitlement_ledger
    WHERE ref_type = 'BOOKING' AND ref_id = ? AND delta_units < 0
  `).bind(booking.id).all<{ grant_id: string; entitlement_code: string; delta_units: number }>();

  let restored = false;
  for (const row of results || []) {
    const res = await releaseEntitlement(db, {
      customerId: booking.customer_id,
      grantId: row.grant_id,
      code: row.entitlement_code,
      units: Math.abs(row.delta_units),
      reason: 'BOOKING_CANCELLED',
      refType: 'BOOKING',
      refId: booking.id,
      // Keyed per grant: one key for the whole booking would let the 0011 UNIQUE index swallow
      // every grant after the first.
      idempotencyKey: `booking:${booking.id}:release:${row.grant_id}`,
    });
    if (res.success) restored = true;
  }
  return restored;
}

/** Issues a Stripe refund. Mock keys report success so the flow is exercisable without live keys. */
async function refundBookingPayment(env: Env, booking: BookingRow): Promise<string> {
  const key = env.STRIPE_SECRET_KEY;
  const intent = booking.stripe_payment_intent_id;
  const isMock = !key || key.startsWith('sk_test_mock') || key === 'placeholder' || (intent || '').startsWith('pi_mock_');

  if (isMock) {
    await env.DB.prepare("UPDATE bookings SET payment_status = 'REFUNDED' WHERE id = ?").bind(booking.id).run();
    return 'REFUNDED';
  }
  if (!intent) {
    await env.DB.prepare("UPDATE bookings SET payment_status = 'REFUND_PENDING' WHERE id = ?").bind(booking.id).run();
    return 'REFUND_PENDING';
  }

  try {
    const body = new URLSearchParams({ payment_intent: intent });
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const status = res.ok ? 'REFUNDED' : 'REFUND_FAILED';
    if (!res.ok) console.error('[bookings] refund failed', await res.text());
    await env.DB.prepare('UPDATE bookings SET payment_status = ? WHERE id = ?').bind(status, booking.id).run();
    return status;
  } catch (err) {
    console.error('[bookings] refund request failed', err);
    await env.DB.prepare("UPDATE bookings SET payment_status = 'REFUND_PENDING' WHERE id = ?").bind(booking.id).run();
    return 'REFUND_PENDING';
  }
}

/** Hands seats back. MAX(0, ...) keeps the table's CHECK constraint satisfiable under any retry. */
async function releaseSeats(db: Env['DB'], slotId: string, seats: number): Promise<void> {
  await db.prepare(`
    UPDATE experience_slots
    SET seats_booked = MAX(0, seats_booked - ?), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(seats, slotId).run();
}

export interface RescheduleResult {
  success: boolean;
  error?: string;
  booking?: BookingDetailRow;
}

/**
 * Moves a booking to a different slot on the same experience, taking the new seat and giving back
 * the old one atomically.
 *
 * Same shared-predicate trick as createBooking, with the statements in the order that makes it
 * work: the `bookings` update goes first so its guard reads the new slot's *pre-increment* seat
 * count, and the slot increment carries the identical guard. Both apply or neither does. The old
 * slot's release is guarded on the booking having actually moved, so a failed move leaves the
 * original seat exactly where it was.
 */
export async function rescheduleBooking(
  env: Env,
  booking: BookingDetailRow,
  newSlot: SlotRow
): Promise<RescheduleResult> {
  const db = env.DB;

  if (!['HOLD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) {
    return { success: false, error: `A ${booking.status.toLowerCase()} booking cannot be rescheduled.` };
  }
  if (newSlot.experience_id !== booking.experience_id) {
    return { success: false, error: 'That slot belongs to a different experience.' };
  }
  if (newSlot.id === booking.slot_id) {
    return { success: false, error: 'That is already your slot.' };
  }
  if (newSlot.status !== 'OPEN' || (toDate(newSlot.starts_at)?.getTime() ?? 0) <= Date.now()) {
    return { success: false, error: 'That slot is not open for booking.' };
  }
  if (!withinCancellationWindow(booking.starts_at, booking.cancellation_cutoff_hours)) {
    return {
      success: false,
      error: `Free rescheduling closed ${booking.cancellation_cutoff_hours} hours before the start time. Please contact support@dailyroast.in.`,
    };
  }

  const seats = booking.seats;
  const oldSlotId = booking.slot_id;

  const moveBooking = db.prepare(`
    UPDATE bookings
    SET slot_id = ?, rescheduled_from_slot_id = ?, reschedule_count = reschedule_count + 1,
        reminder_sent_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND slot_id = ?
      AND EXISTS (
        SELECT 1 FROM experience_slots s
        WHERE s.id = ? AND s.status = 'OPEN' AND s.seats_booked + ? <= s.seats_total
      )
  `).bind(newSlot.id, oldSlotId, booking.id, oldSlotId, newSlot.id, seats);

  const takeNewSeat = db.prepare(`
    UPDATE experience_slots
    SET seats_booked = seats_booked + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'OPEN' AND seats_booked + ? <= seats_total
  `).bind(seats, newSlot.id, seats);

  const releaseOldSeat = db.prepare(`
    UPDATE experience_slots
    SET seats_booked = MAX(0, seats_booked - ?), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.slot_id = ?)
  `).bind(seats, oldSlotId, booking.id, newSlot.id);

  const [moveResult] = await db.batch([moveBooking, takeNewSeat, releaseOldSeat]);

  if (changesOf(moveResult) === 0) {
    return { success: false, error: 'That slot filled up. Please pick another time.' };
  }

  // The freed seat on the old slot may be someone's turn.
  await promoteFromWaitlist(env, oldSlotId);

  const updated = await getBookingDetail(db, booking.id);
  if (updated && updated.status === 'CONFIRMED') await sendConfirmationEmail(env, updated, { rescheduled: true });
  return { success: true, booking: updated ?? undefined };
}

/** Staff-side attendance marking (5.5). */
export async function markAttendance(
  db: Env['DB'],
  bookingId: string,
  outcome: 'ATTENDED' | 'NO_SHOW',
  staffNotes?: string | null
): Promise<boolean> {
  const sql = outcome === 'ATTENDED'
    ? `UPDATE bookings SET status = 'COMPLETED', attended_at = CURRENT_TIMESTAMP, no_show_at = NULL,
         staff_notes = COALESCE(?, staff_notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('CONFIRMED','COMPLETED','NO_SHOW')`
    : `UPDATE bookings SET status = 'NO_SHOW', no_show_at = CURRENT_TIMESTAMP, attended_at = NULL,
         staff_notes = COALESCE(?, staff_notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('CONFIRMED','COMPLETED','NO_SHOW')`;

  // A no-show keeps the seat consumed: the entitlement is spent and the payment is not refunded.
  // That is the policy the cancellation window exists to enforce.
  const res = await db.prepare(sql).bind(staffNotes ?? null, bookingId).run();
  return changesOf(res) > 0;
}

// ---------------------------------------------------------------------------
// Waitlist promotion
// ---------------------------------------------------------------------------

/**
 * Offers a freed seat to the longest-waiting customer on the slot. The offer takes the seat
 * immediately — otherwise the notification email would be an invitation to race everyone else —
 * and expires back into the pool if unconfirmed.
 */
export async function promoteFromWaitlist(env: Env, slotId: string): Promise<string | null> {
  const db = env.DB;

  const next = await db.prepare(`
    SELECT * FROM bookings
    WHERE slot_id = ? AND status = 'WAITLISTED'
    ORDER BY created_at ASC LIMIT 1
  `).bind(slotId).first<BookingRow>();
  if (!next) return null;

  const offerExpires = isoIn(WAITLIST_OFFER_HOURS * 3600_000);

  const offer = db.prepare(`
    UPDATE bookings
    SET status = 'WAITLIST_OFFERED', hold_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'WAITLISTED'
      AND EXISTS (
        SELECT 1 FROM experience_slots s
        WHERE s.id = ? AND s.status = 'OPEN' AND s.seats_booked + ? <= s.seats_total
      )
  `).bind(offerExpires, next.id, slotId, next.seats);

  const takeSeat = db.prepare(`
    UPDATE experience_slots
    SET seats_booked = seats_booked + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'OPEN' AND seats_booked + ? <= seats_total
  `).bind(next.seats, slotId, next.seats);

  const [offerResult] = await db.batch([offer, takeSeat]);
  if (changesOf(offerResult) === 0) return null;

  const detail = await getBookingDetail(db, next.id);
  if (detail) await sendWaitlistOfferEmail(env, detail);
  return next.id;
}

// ---------------------------------------------------------------------------
// 5.4 — Calendar invite
// ---------------------------------------------------------------------------

function icsEscape(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStamp(value: string | null | undefined): string {
  const d = toDate(value) ?? new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 VEVENT. Times are emitted as UTC (trailing Z); the calendar client localises them. */
export function buildIcs(booking: BookingDetailRow): string {
  const isVideo = booking.mode === 'VIDEO';
  const where = isVideo ? (booking.meeting_url || 'Online') : (booking.location || 'The Daily Roast');

  const descriptionParts = [
    `Booking reference: ${booking.booking_reference}`,
    booking.seats > 1 ? `Party of ${booking.party_size}` : null,
    isVideo && booking.meeting_url ? `Join: ${booking.meeting_url}` : null,
    booking.staff_name ? `Host: ${booking.staff_name}` : null,
    booking.cancellation_policy,
  ].filter(Boolean) as string[];

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Daily Roast//Experiences//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@dailyroast.in`,
    `DTSTAMP:${icsStamp(nowIso())}`,
    `DTSTART:${icsStamp(booking.starts_at)}`,
    `DTEND:${icsStamp(booking.ends_at)}`,
    `SUMMARY:${icsEscape(booking.experience_name)} — The Daily Roast`,
    `DESCRIPTION:${icsEscape(descriptionParts.join('\n'))}`,
    `LOCATION:${icsEscape(where)}`,
    booking.meeting_url ? `URL:${icsEscape(booking.meeting_url)}` : null,
    `STATUS:${booking.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(booking.experience_name)} tomorrow`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

// ---------------------------------------------------------------------------
// 5.4 — Emails (house style follows services/emailTemplate.ts)
// ---------------------------------------------------------------------------

interface EmailPayload { to: string; subject: string; html: string }

function shell(innerHtml: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><title>The Daily Roast</title></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fcf9f5; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #ede5dc; padding: 36px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <div style="text-align: center; border-bottom: 2px solid #d4883b; padding-bottom: 20px; margin-bottom: 24px;">
          <h1 style="color: #1c1512; margin: 0; font-size: 24px; letter-spacing: 1px;">☕ THE DAILY ROAST</h1>
          <p style="color: #8c7e72; font-size: 12px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 2px;">Small Batch Specialty Roastery</p>
        </div>
        ${innerHtml}
      </div>
    </body>
    </html>
  `;
}

function detailsTable(booking: BookingDetailRow, apiBase: string): string {
  const isVideo = booking.mode === 'VIDEO';
  const when = booking.is_multi_day
    ? `${formatDateInRoasteryTime(booking.starts_at, booking.display_timezone)} — ${formatDateInRoasteryTime(booking.ends_at, booking.display_timezone)}`
    : formatInRoasteryTime(booking.starts_at, booking.display_timezone);

  const rows: [string, string][] = [
    ['When', escHtml(when)],
    ['Where', isVideo
      ? (booking.meeting_url
          ? `<a href="${escHtml(booking.meeting_url)}" style="color:#a9622a;">Join the video call</a>`
          : 'A video link will be emailed before your call')
      : escHtml(booking.location || 'The Daily Roast Roastery')],
    ['Reference', escHtml(booking.booking_reference)],
  ];
  if (booking.party_size > 1) rows.push(['Party', `${booking.party_size} people`]);
  if (booking.staff_name) rows.push(['Your host', escHtml(booking.staff_name)]);
  if (booking.funding_source === 'ENTITLEMENT') {
    rows.push(['Paid with', 'Your subscription credit']);
  } else if (booking.amount_cents > 0) {
    rows.push([booking.deposit_cents > 0 ? 'Deposit paid' : 'Paid',
      escHtml(formatMoney(booking.deposit_cents > 0 ? booking.deposit_cents : booking.amount_cents, booking.currency))]);
  }
  if (booking.dietary_notes) rows.push(['Dietary notes', escHtml(booking.dietary_notes)]);
  if (booking.accessibility_notes) rows.push(['Accessibility', escHtml(booking.accessibility_notes)]);

  const body = rows.map(([k, v]) => `
    <tr style="border-bottom: 1px solid #f0eae3;">
      <td style="padding: 10px 0; color: #8c7e72; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; width: 38%;">${k}</td>
      <td style="padding: 10px 0; color: #1c1512; font-size: 15px;">${v}</td>
    </tr>
  `).join('');

  const icsUrl = `${apiBase}/api/experiences/bookings/${booking.id}/calendar.ics?token=${booking.ics_token}`;

  return `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">${body}</table>
    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="${icsUrl}" style="background: #1c1512; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
        Add to your calendar
      </a>
    </div>
  `;
}

export function generateBookingConfirmationEmail(
  booking: BookingDetailRow,
  apiBase: string,
  opts: { rescheduled?: boolean } = {}
): EmailPayload {
  const heading = opts.rescheduled ? 'Your booking has moved' : 'You’re booked in';
  const intro = opts.rescheduled
    ? 'We’ve moved your booking to the new time below. Everything else stays as it was.'
    : booking.mode === 'VIDEO'
      ? 'Your call is confirmed. Have your grinder, brewer and the bag you’re working on to hand — fifteen minutes goes quickly.'
      : 'Your place is confirmed. We’ll have a cup waiting for you.';

  return {
    to: booking.customer_email,
    subject: `${opts.rescheduled ? 'Rescheduled' : 'Confirmed'}: ${booking.experience_name} · ${booking.booking_reference}`,
    html: shell(`
      <h2 style="color: #1c1512; font-size: 20px; margin-top: 0;">${escHtml(heading)}, ${escHtml(booking.customer_name || 'Coffee Lover')}!</h2>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">${escHtml(intro)}</p>
      <h3 style="color: #1c1512; font-size: 17px; margin-bottom: 0;">${escHtml(booking.experience_name)}</h3>
      ${detailsTable(booking, apiBase)}
      ${booking.cancellation_policy ? `
        <div style="background: #fdf8f0; border-radius: 8px; padding: 16px; border: 1px dashed #d4883b; margin-top: 20px;">
          <p style="margin: 0; font-size: 13px; color: #7a4b1b;">${escHtml(booking.cancellation_policy)}</p>
        </div>` : ''}
      <p style="color: #8c7e72; font-size: 12px; margin-top: 24px;">All times shown are India Standard Time (Asia/Kolkata).</p>
    `),
  };
}

export function generateBookingReminderEmail(booking: BookingDetailRow, apiBase: string): EmailPayload {
  const isVideo = booking.mode === 'VIDEO';
  return {
    to: booking.customer_email,
    subject: `Tomorrow: ${booking.experience_name} · ${booking.booking_reference}`,
    html: shell(`
      <h2 style="color: #1c1512; font-size: 20px; margin-top: 0;">See you tomorrow, ${escHtml(booking.customer_name || 'Coffee Lover')}</h2>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
        ${isVideo
          ? 'A quick reminder about your call tomorrow. Test your camera and mic beforehand if you can, and have your kit set up.'
          : 'A quick reminder about your visit tomorrow. Come a few minutes early — we start on time and the first pour waits for nobody.'}
      </p>
      <h3 style="color: #1c1512; font-size: 17px; margin-bottom: 0;">${escHtml(booking.experience_name)}</h3>
      ${detailsTable(booking, apiBase)}
      <p style="color: #8c7e72; font-size: 12px; margin-top: 24px;">All times shown are India Standard Time (Asia/Kolkata).</p>
    `),
  };
}

export function generateWaitlistOfferEmail(booking: BookingDetailRow, storefrontUrl: string): EmailPayload {
  const when = formatInRoasteryTime(booking.starts_at, booking.display_timezone);
  return {
    to: booking.customer_email,
    subject: `A place opened up: ${booking.experience_name}`,
    html: shell(`
      <h2 style="color: #1c1512; font-size: 20px; margin-top: 0;">A place just opened up</h2>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
        Someone released their place on <strong>${escHtml(booking.experience_name)}</strong> on
        ${escHtml(when)}, and you were next on the list. We’re holding it for you for the next
        ${WAITLIST_OFFER_HOURS} hours — confirm it before then and it’s yours.
      </p>
      <div style="text-align: center; margin: 28px 0 8px;">
        <a href="${escHtml(storefrontUrl)}/?booking_claim=${escHtml(booking.id)}#experiences" style="background: #1c1512; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
          Confirm my place
        </a>
      </div>
      <p style="color: #8c7e72; font-size: 12px; margin-top: 24px;">All times shown are India Standard Time (Asia/Kolkata).</p>
    `),
  };
}

export function generateBookingCancellationEmail(
  booking: BookingDetailRow,
  opts: { entitlementRestored?: boolean; refundStatus?: string }
): EmailPayload {
  const outcome = opts.entitlementRestored
    ? 'Your subscription credit has been put back on your account and is ready to use again.'
    : opts.refundStatus === 'REFUNDED'
      ? 'Your payment has been refunded — allow a few working days for it to appear.'
      : opts.refundStatus === 'NOT_REFUNDABLE'
        ? 'As set out in the booking policy, the amount paid is not refundable for this cancellation.'
        : opts.refundStatus
          ? 'Your refund is being processed and we’ll email again once it’s on its way.'
          : 'Nothing was charged for this booking.';

  return {
    to: booking.customer_email,
    subject: `Cancelled: ${booking.experience_name} · ${booking.booking_reference}`,
    html: shell(`
      <h2 style="color: #1c1512; font-size: 20px; margin-top: 0;">Your booking is cancelled</h2>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">
        We’ve cancelled <strong>${escHtml(booking.experience_name)}</strong> on
        ${escHtml(formatInRoasteryTime(booking.starts_at, booking.display_timezone))}
        (reference ${escHtml(booking.booking_reference)}).
      </p>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">${escHtml(outcome)}</p>
      <p style="color: #554a41; line-height: 1.6; font-size: 15px;">We’d love to see you another time.</p>
    `),
  };
}

function mailer(env: Env): ResendEmailService {
  return new ResendEmailService(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
}

/** The public API origin, used to build the .ics link that goes into emails. */
function apiBaseFor(env: Env): string {
  return env.ENVIRONMENT === 'production' ? 'https://api.dailyroast.in' : 'http://localhost:8787';
}

export async function sendConfirmationEmail(
  env: Env,
  booking: BookingDetailRow,
  opts: { rescheduled?: boolean } = {}
): Promise<void> {
  const payload = generateBookingConfirmationEmail(booking, apiBaseFor(env), opts);
  const res = await mailer(env).send(payload.to, payload.subject, payload.html);
  if (res.success) {
    await env.DB.prepare('UPDATE bookings SET confirmation_sent_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(booking.id).run();
  }
}

async function sendWaitlistOfferEmail(env: Env, booking: BookingDetailRow): Promise<void> {
  const payload = generateWaitlistOfferEmail(booking, env.STOREFRONT_URL || 'https://dailyroast.in');
  await mailer(env).send(payload.to, payload.subject, payload.html);
}

async function sendCancellationEmail(
  env: Env,
  booking: BookingDetailRow,
  opts: { entitlementRestored?: boolean; refundStatus?: string }
): Promise<void> {
  const payload = generateBookingCancellationEmail(booking, opts);
  await mailer(env).send(payload.to, payload.subject, payload.html);
}

// ---------------------------------------------------------------------------
// Scheduled sweeps
//
// All three of these want to run from the cron in apps/api/src/index.ts, which this feature is not
// allowed to edit. They are exposed instead on a Zero-Trust-guarded admin endpoint
// (POST /api/experiences/admin/maintenance/run) so they can be triggered externally until the cron
// is wired. See the follow-up note in the handover.
// ---------------------------------------------------------------------------

/**
 * T-24h reminders. `horizonHours` is a parameter rather than a constant so the roadmap's second
 * reminder (T-1h) is a caller change and not a rewrite of this function.
 */
export async function sendDueReminders(env: Env, horizonHours = 24): Promise<number> {
  const cutoff = isoIn(horizonHours * 3600_000);
  const { results } = await env.DB.prepare(`
    ${BOOKING_DETAIL_SQL}
    WHERE b.status = 'CONFIRMED'
      AND b.reminder_sent_at IS NULL
      AND s.starts_at > ?
      AND s.starts_at <= ?
      AND s.status = 'OPEN'
    LIMIT 200
  `).bind(nowIso(), cutoff).all<BookingDetailRow>();

  let sent = 0;
  for (const booking of results || []) {
    const payload = generateBookingReminderEmail(booking, apiBaseFor(env));
    const res = await mailer(env).send(payload.to, payload.subject, payload.html);
    if (!res.success) continue;
    // Stamped only on a successful send, so a Resend outage retries on the next pass rather than
    // silently swallowing the reminder.
    await env.DB.prepare('UPDATE bookings SET reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(booking.id).run();
    sent++;
  }
  return sent;
}

/**
 * Returns seats from holds nobody funded, and from waitlist offers nobody claimed.
 *
 * A booking with a Stripe session is deliberately excluded: the customer may have paid and closed
 * the tab, and releasing a seat somebody has paid for is far worse than holding it a while longer.
 * Those are handled by `reconcilePendingPayments` instead.
 */
export async function expireStaleHolds(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT id, slot_id, seats FROM bookings
    WHERE status IN ('HOLD', 'WAITLIST_OFFERED')
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at <= ?
      AND stripe_session_id IS NULL
    LIMIT 200
  `).bind(nowIso()).all<{ id: string; slot_id: string; seats: number }>();

  let expired = 0;
  for (const row of results || []) {
    const res = await env.DB.prepare(`
      UPDATE bookings SET status = 'EXPIRED', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('HOLD', 'WAITLIST_OFFERED')
    `).bind(row.id).run();
    if (changesOf(res) === 0) continue;   // someone confirmed it in the meantime

    await releaseSeats(env.DB, row.slot_id, row.seats);
    await promoteFromWaitlist(env, row.slot_id);
    expired++;
  }
  return expired;
}

/**
 * Closes the loop on customers who paid at Stripe and never returned to the storefront: confirms
 * the ones Stripe says paid, releases the seats of the ones it says did not.
 */
export async function reconcilePendingPayments(env: Env): Promise<{ confirmed: number; released: number }> {
  const cutoff = isoIn(-PENDING_PAYMENT_MINUTES * 60_000);
  const { results } = await env.DB.prepare(`
    ${BOOKING_DETAIL_SQL}
    WHERE b.status = 'PENDING_PAYMENT'
      AND b.stripe_session_id IS NOT NULL
      AND b.updated_at <= ?
    LIMIT 100
  `).bind(cutoff).all<BookingDetailRow>();

  let confirmed = 0;
  let released = 0;

  for (const booking of results || []) {
    const state = await fetchSessionPaymentState(env, booking.stripe_session_id!);
    if (state.paid) {
      if (state.paymentIntentId) {
        await env.DB.prepare('UPDATE bookings SET stripe_payment_intent_id = ? WHERE id = ?')
          .bind(state.paymentIntentId, booking.id).run();
      }
      await finaliseConfirmation(env, booking, 'PAID');
      confirmed++;
    } else {
      const res = await env.DB.prepare(`
        UPDATE bookings SET status = 'EXPIRED', hold_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING_PAYMENT'
      `).bind(booking.id).run();
      if (changesOf(res) === 0) continue;
      await releaseSeats(env.DB, booking.slot_id, booking.seats);
      await promoteFromWaitlist(env, booking.slot_id);
      released++;
    }
  }
  return { confirmed, released };
}
