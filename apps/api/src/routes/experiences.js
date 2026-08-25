import { Hono } from 'hono';
import { resolveCustomerSession, UNAUTHENTICATED } from '../middleware/customerAuth';
import { zeroTrustAdminGuard, recordAuditLog } from '../middleware/zeroTrust';
import { getBalances } from '../services/entitlements';
import { listExperiences, getExperience, listAvailableSlots, getBookingDetail, listCustomerBookings, createBooking, confirmBooking, settleBookingPayment, cancelBooking, rescheduleBooking, markAttendance, promoteFromWaitlist, buildIcs, seatPriceCents, withinCancellationWindow, sendDueReminders, expireStaleHolds, reconcilePendingPayments, } from '../services/bookings';
// Bookable experiences: teleconsultation, roastery tour, cupping session, estate visit.
// Owner: Phase 5 — experiences. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
//
// Admin endpoints live under /admin on this same app rather than in routes/admin.ts, guarded by the
// same Cloudflare Zero Trust middleware, so this feature never has to touch another feature's file.
const experiencesApp = new Hono();
function newId(prefix) {
    return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
/** Resolves the customer session or writes the 401 — every customer endpoint starts here. */
async function requireCustomer(c) {
    return resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
}
/**
 * Fetches a booking and proves it belongs to this customer. Authentication alone is not enough:
 * without the ownership check any signed-in customer could read or cancel anyone else's booking by
 * guessing an id.
 */
async function ownedBooking(c, session, bookingId) {
    const booking = await getBookingDetail(c.env.DB, bookingId);
    if (!booking || booking.customer_id !== session.customerId)
        return null;
    return booking;
}
/** A slot as the storefront may see it. The meeting link is deliberately not included. */
function publicSlot(experience, slot) {
    const available = Math.max(0, slot.seats_total - slot.seats_booked);
    return {
        id: slot.id,
        experience_id: slot.experience_id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        seats_total: slot.seats_total,
        seats_booked: slot.seats_booked,
        seats_available: available,
        staff_name: slot.staff_name,
        location: slot.location_override || experience.location_address || experience.location_name,
        price_cents: seatPriceCents(experience, slot),
        currency: experience.currency,
        is_full: available <= 0,
    };
}
/**
 * A booking as its owner may see it. The video-room link is withheld until the booking is actually
 * confirmed — an unfunded hold must not hand out the meeting URL.
 */
function publicBooking(booking) {
    const confirmed = ['CONFIRMED', 'COMPLETED'].includes(booking.status);
    return {
        ...booking,
        meeting_url: confirmed ? booking.meeting_url : null,
        can_self_manage: ['HOLD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status) &&
            withinCancellationWindow(booking.starts_at, booking.cancellation_cutoff_hours),
    };
}
/** Free-text fields are stored raw but bounded, so one booking cannot carry a novel. */
function trimNote(value, max = 1000) {
    const s = typeof value === 'string' ? value.trim() : '';
    return s ? s.slice(0, max) : null;
}
// ===========================================================================
// 5.1 — Public catalog
// ===========================================================================
/** The four experiences, each with its next few open slots so the storefront renders in one call. */
experiencesApp.get('/', async (c) => {
    const experiences = await listExperiences(c.env.DB);
    const withSlots = await Promise.all(experiences.map(async (experience) => {
        const slots = await listAvailableSlots(c.env.DB, experience.id);
        return {
            ...experience,
            next_slots: slots.slice(0, 6).map((s) => publicSlot(experience, s)),
            slot_count: slots.length,
        };
    }));
    return c.json({ success: true, experiences: withSlots });
});
experiencesApp.get('/catalog/:slug', async (c) => {
    const experience = await getExperience(c.env.DB, c.req.param('slug'));
    if (!experience || experience.status !== 'ACTIVE') {
        return c.json({ success: false, error: 'Experience not found' }, 404);
    }
    const slots = await listAvailableSlots(c.env.DB, experience.id, {
        from: c.req.query('from'),
        to: c.req.query('to'),
    });
    return c.json({ success: true, experience, slots: slots.map((s) => publicSlot(experience, s)) });
});
// ===========================================================================
// 5.3 — Booking flow
// ===========================================================================
/** Entitlement balances, so the storefront can say "included with your plan" before booking. */
experiencesApp.get('/me/entitlements', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    return c.json({ success: true, balances: await getBalances(c.env.DB, session.customerId) });
});
experiencesApp.get('/bookings', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const bookings = await listCustomerBookings(c.env.DB, session.customerId);
    return c.json({ success: true, bookings: bookings.map(publicBooking) });
});
experiencesApp.get('/bookings/:id', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const booking = await ownedBooking(c, session, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    return c.json({ success: true, booking: publicBooking(booking) });
});
/** Places a hold on a seat, or joins the waitlist when the slot is already full. */
experiencesApp.post('/bookings', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const body = await c.req.json().catch(() => ({}));
    const slotId = String(body.slotId || '');
    if (!slotId)
        return c.json({ success: false, error: 'slotId is required' }, 400);
    const slot = await c.env.DB.prepare('SELECT * FROM experience_slots WHERE id = ?').bind(slotId).first();
    if (!slot)
        return c.json({ success: false, error: 'Slot not found' }, 404);
    const experience = await getExperience(c.env.DB, slot.experience_id);
    if (!experience || experience.status !== 'ACTIVE') {
        return c.json({ success: false, error: 'Experience not available' }, 404);
    }
    const customer = await c.env.DB
        .prepare('SELECT full_name, phone FROM customers WHERE id = ?')
        .bind(session.customerId)
        .first();
    const result = await createBooking(c.env.DB, {
        experience,
        slot,
        customerId: session.customerId,
        customerEmail: session.email,
        customerName: customer?.full_name || null,
        contactPhone: trimNote(body.contactPhone, 32) || customer?.phone || null,
        partySize: Number(body.partySize) || 1,
        dietaryNotes: experience.collects_notes ? trimNote(body.dietaryNotes) : null,
        accessibilityNotes: experience.collects_notes ? trimNote(body.accessibilityNotes) : null,
        idempotencyKey: trimNote(body.idempotencyKey, 100),
    });
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    return c.json({
        success: true,
        booking: result.booking ? publicBooking(result.booking) : null,
        waitlisted: !!result.waitlisted,
        reused: !!result.reused,
    });
});
/**
 * Funds a hold. Prefers the customer's entitlement and falls back to a Stripe Checkout Session
 * created right here — routes/checkout.ts belongs to another feature.
 */
experiencesApp.post('/bookings/:id/confirm', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const booking = await ownedBooking(c, session, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const preferred = body.fundingSource === 'PAID' ? 'PAID' : undefined;
    const result = await confirmBooking(c.env, booking, { preferred });
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    return c.json({
        success: true,
        booking: result.booking ? publicBooking(result.booking) : null,
        checkoutUrl: result.checkoutUrl,
        fundingSource: result.fundingSource,
    });
});
/** Called when the customer returns from Stripe; verifies the session before confirming. */
experiencesApp.post('/bookings/:id/settle', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const booking = await ownedBooking(c, session, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    const result = await settleBookingPayment(c.env, booking);
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, booking: result.booking ? publicBooking(result.booking) : null });
});
// ===========================================================================
// 5.5 — Self-serve reschedule & cancel
// ===========================================================================
experiencesApp.post('/bookings/:id/reschedule', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const booking = await ownedBooking(c, session, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const newSlot = await c.env.DB
        .prepare('SELECT * FROM experience_slots WHERE id = ?')
        .bind(String(body.slotId || ''))
        .first();
    if (!newSlot)
        return c.json({ success: false, error: 'Slot not found' }, 404);
    const result = await rescheduleBooking(c.env, booking, newSlot);
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, booking: result.booking ? publicBooking(result.booking) : null });
});
experiencesApp.post('/bookings/:id/cancel', async (c) => {
    const session = await requireCustomer(c);
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const booking = await ownedBooking(c, session, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const result = await cancelBooking(c.env, booking, { reason: trimNote(body.reason, 200) || undefined });
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    return c.json({
        success: true,
        booking: result.booking ? publicBooking(result.booking) : null,
        entitlementRestored: result.entitlementRestored,
        refundStatus: result.refundStatus,
    });
});
// ===========================================================================
// 5.4 — Calendar invite
// ===========================================================================
/**
 * Serves the .ics for one booking. Authenticated by the booking's own unguessable `ics_token`
 * rather than the session header, because this link is clicked from a mail client that carries no
 * session — and putting a session token in a URL that lands in an inbox would be worse.
 */
experiencesApp.get('/bookings/:id/calendar.ics', async (c) => {
    const token = c.req.query('token') || '';
    if (!token)
        return c.text('Not found', 404);
    const booking = await c.env.DB
        .prepare(`
      SELECT b.*, e.name AS experience_name, e.slug AS experience_slug, e.experience_type, e.mode,
             e.display_timezone, e.cancellation_policy, e.cancellation_cutoff_hours, e.refund_on_cancel,
             e.is_multi_day, s.starts_at, s.ends_at, s.staff_name,
             COALESCE(s.location_override, e.location_address, e.location_name) AS location, s.meeting_url
      FROM bookings b
      JOIN experiences e ON e.id = b.experience_id
      JOIN experience_slots s ON s.id = b.slot_id
      WHERE b.id = ? AND b.ics_token = ?
    `)
        .bind(c.req.param('id'), token)
        .first();
    if (!booking)
        return c.text('Not found', 404);
    return new Response(buildIcs(booking), {
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${booking.booking_reference}.ics"`,
            'Cache-Control': 'no-store',
        },
    });
});
// ===========================================================================
// Admin — same Cloudflare Zero Trust guard routes/admin.ts uses
// ===========================================================================
const adminRoutes = new Hono();
adminRoutes.use('*', zeroTrustAdminGuard);
/** Catalog, including DRAFT and ARCHIVED rows the storefront never sees. */
adminRoutes.get('/experiences', async (c) => {
    return c.json({ success: true, experiences: await listExperiences(c.env.DB, true) });
});
/** Catalog editing (5.1). Only the fields staff actually change are writable. */
adminRoutes.patch('/experiences/:id', async (c) => {
    const actor = c.get('adminActor');
    const id = c.req.param('id');
    const before = await getExperience(c.env.DB, id);
    if (!before)
        return c.json({ success: false, error: 'Experience not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const editable = {
        name: 'text', tagline: 'text', description: 'text', price_cents: 'int', deposit_cents: 'int',
        default_capacity: 'int', duration_minutes: 'int', cancellation_cutoff_hours: 'int',
        cancellation_policy: 'text', refund_on_cancel: 'int', location_name: 'text',
        location_address: 'text', max_party_size: 'int', collects_notes: 'int', image_url: 'text',
        sort_order: 'int', status: 'text', entitlement_code: 'text',
    };
    const sets = [];
    const params = [];
    for (const [field, kind] of Object.entries(editable)) {
        if (!(field in body))
            continue;
        sets.push(`${field} = ?`);
        params.push(kind === 'int' ? Number(body[field]) || 0 : (body[field] ?? null));
    }
    if (!sets.length)
        return c.json({ success: false, error: 'Nothing to update' }, 400);
    params.push(id);
    await c.env.DB.prepare(`UPDATE experiences SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...params).run();
    const after = await getExperience(c.env.DB, id);
    await recordAuditLog(c.env.DB, actor, 'EXPERIENCE_UPDATE', 'experience', id, before, after, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, experience: after });
});
// --- 5.2 Slot CRUD ---------------------------------------------------------
adminRoutes.get('/slots', async (c) => {
    const experienceId = c.req.query('experienceId');
    const clauses = [];
    const params = [];
    if (experienceId) {
        clauses.push('s.experience_id = ?');
        params.push(experienceId);
    }
    if (c.req.query('upcoming') === '1') {
        clauses.push('s.ends_at >= ?');
        params.push(new Date().toISOString());
    }
    const { results } = await c.env.DB.prepare(`
    SELECT s.*, e.name AS experience_name, e.mode, e.display_timezone
    FROM experience_slots s
    JOIN experiences e ON e.id = s.experience_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY s.starts_at ASC
    LIMIT 300
  `).bind(...params).all();
    return c.json({ success: true, slots: results || [] });
});
adminRoutes.post('/slots', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json().catch(() => ({}));
    const experience = await getExperience(c.env.DB, String(body.experienceId || ''));
    if (!experience)
        return c.json({ success: false, error: 'Experience not found' }, 404);
    const startsAt = new Date(String(body.startsAt || ''));
    if (isNaN(startsAt.getTime()))
        return c.json({ success: false, error: 'startsAt must be a valid date' }, 400);
    // The client sends an instant (an ISO string with an offset); we store UTC. Where no explicit
    // end is given, the catalog duration defines it — except for multi-day experiences, where the
    // end date is the whole point and must be supplied.
    let endsAt;
    if (body.endsAt) {
        endsAt = new Date(String(body.endsAt));
    }
    else if (experience.duration_minutes) {
        endsAt = new Date(startsAt.getTime() + experience.duration_minutes * 60_000);
    }
    else {
        return c.json({ success: false, error: 'endsAt is required for a multi-day experience' }, 400);
    }
    if (isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return c.json({ success: false, error: 'endsAt must be after startsAt' }, 400);
    }
    const id = newId('slot');
    const seatsTotal = Math.max(1, Number(body.seatsTotal) || experience.default_capacity);
    await c.env.DB.prepare(`
    INSERT INTO experience_slots (
      id, experience_id, starts_at, ends_at, seats_total, seats_booked,
      staff_name, staff_email, meeting_url, location_override, price_cents_override, status, notes
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).bind(id, experience.id, startsAt.toISOString(), endsAt.toISOString(), seatsTotal, body.staffName || null, body.staffEmail || null, experience.mode === 'VIDEO' ? (body.meetingUrl || null) : null, body.locationOverride || null, body.priceCentsOverride != null ? Number(body.priceCentsOverride) : null, body.notes || null).run();
    const slot = await c.env.DB.prepare('SELECT * FROM experience_slots WHERE id = ?').bind(id).first();
    await recordAuditLog(c.env.DB, actor, 'SLOT_CREATE', 'experience_slot', id, null, slot, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, slot });
});
adminRoutes.patch('/slots/:id', async (c) => {
    const actor = c.get('adminActor');
    const id = c.req.param('id');
    const before = await c.env.DB.prepare('SELECT * FROM experience_slots WHERE id = ?').bind(id).first();
    if (!before)
        return c.json({ success: false, error: 'Slot not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const sets = [];
    const params = [];
    if (body.startsAt) {
        sets.push('starts_at = ?');
        params.push(new Date(String(body.startsAt)).toISOString());
    }
    if (body.endsAt) {
        sets.push('ends_at = ?');
        params.push(new Date(String(body.endsAt)).toISOString());
    }
    if (body.staffName !== undefined) {
        sets.push('staff_name = ?');
        params.push(body.staffName || null);
    }
    if (body.staffEmail !== undefined) {
        sets.push('staff_email = ?');
        params.push(body.staffEmail || null);
    }
    if (body.meetingUrl !== undefined) {
        sets.push('meeting_url = ?');
        params.push(body.meetingUrl || null);
    }
    if (body.locationOverride !== undefined) {
        sets.push('location_override = ?');
        params.push(body.locationOverride || null);
    }
    if (body.notes !== undefined) {
        sets.push('notes = ?');
        params.push(body.notes || null);
    }
    if (body.status) {
        sets.push('status = ?');
        params.push(String(body.status));
    }
    if (body.seatsTotal !== undefined) {
        const seatsTotal = Math.max(1, Number(body.seatsTotal) || 1);
        // Capacity may never be cut below what is already booked — the table's CHECK would reject it,
        // and silently dropping somebody's confirmed seat would be worse if it did not.
        if (seatsTotal < before.seats_booked) {
            return c.json({
                success: false,
                error: `Cannot reduce capacity to ${seatsTotal}: ${before.seats_booked} places are already booked.`,
            }, 400);
        }
        sets.push('seats_total = ?');
        params.push(seatsTotal);
    }
    if (!sets.length)
        return c.json({ success: false, error: 'Nothing to update' }, 400);
    params.push(id);
    await c.env.DB.prepare(`UPDATE experience_slots SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...params).run();
    const after = await c.env.DB.prepare('SELECT * FROM experience_slots WHERE id = ?').bind(id).first();
    await recordAuditLog(c.env.DB, actor, 'SLOT_UPDATE', 'experience_slot', id, before, after, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, slot: after });
});
/**
 * Cancels a slot rather than deleting it: the bookings on it must survive so the customers can be
 * told, and so the audit trail keeps its foreign keys.
 */
adminRoutes.delete('/slots/:id', async (c) => {
    const actor = c.get('adminActor');
    const id = c.req.param('id');
    const slot = await c.env.DB.prepare('SELECT * FROM experience_slots WHERE id = ?').bind(id).first();
    if (!slot)
        return c.json({ success: false, error: 'Slot not found' }, 404);
    const { results } = await c.env.DB.prepare(`
    SELECT b.id FROM bookings b
    WHERE b.slot_id = ? AND b.status IN ('HOLD','PENDING_PAYMENT','CONFIRMED','WAITLIST_OFFERED','WAITLISTED')
  `).bind(id).all();
    await c.env.DB.prepare("UPDATE experience_slots SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(id).run();
    // byStaff bypasses the customer cancellation window — the roastery is the one calling it off,
    // so entitlements go back and payments are refunded regardless of how close the date is.
    let cancelled = 0;
    for (const row of results || []) {
        const booking = await getBookingDetail(c.env.DB, row.id);
        if (!booking)
            continue;
        const res = await cancelBooking(c.env, booking, { byStaff: true, reason: 'Slot cancelled by the roastery' });
        if (res.success)
            cancelled++;
    }
    await recordAuditLog(c.env.DB, actor, 'SLOT_CANCEL', 'experience_slot', id, slot, { cancelled_bookings: cancelled }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, cancelledBookings: cancelled });
});
/** The roster for one slot: who is coming, what they paid with, and their notes (5.2/5.6). */
adminRoutes.get('/slots/:id/roster', async (c) => {
    const id = c.req.param('id');
    const slot = await c.env.DB.prepare(`
    SELECT s.*, e.name AS experience_name, e.mode, e.display_timezone, e.is_multi_day
    FROM experience_slots s JOIN experiences e ON e.id = s.experience_id
    WHERE s.id = ?
  `).bind(id).first();
    if (!slot)
        return c.json({ success: false, error: 'Slot not found' }, 404);
    const { results } = await c.env.DB.prepare(`
    SELECT b.id, b.booking_reference, b.customer_name, b.customer_email, b.contact_phone,
           b.status, b.seats, b.party_size, b.funding_source, b.amount_cents, b.currency,
           b.payment_status, b.dietary_notes, b.accessibility_notes, b.attended_at, b.no_show_at,
           b.staff_notes, b.created_at
    FROM bookings b
    WHERE b.slot_id = ?
    ORDER BY CASE b.status WHEN 'WAITLISTED' THEN 2 WHEN 'CANCELLED' THEN 3 WHEN 'EXPIRED' THEN 3 ELSE 1 END,
             b.created_at ASC
  `).bind(id).all();
    return c.json({ success: true, slot, roster: results || [] });
});
/** 5.5 — staff-side attended / no-show marking. */
adminRoutes.post('/bookings/:id/attendance', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json().catch(() => ({}));
    const outcome = body.outcome === 'NO_SHOW' ? 'NO_SHOW' : 'ATTENDED';
    const ok = await markAttendance(c.env.DB, c.req.param('id'), outcome, body.staffNotes ?? null);
    if (!ok)
        return c.json({ success: false, error: 'Booking not found, or not in a markable state.' }, 400);
    await recordAuditLog(c.env.DB, actor, `BOOKING_${outcome}`, 'booking', c.req.param('id'), null, { outcome }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, booking: await getBookingDetail(c.env.DB, c.req.param('id')) });
});
/** Staff cancellation, outside the customer-facing policy window. */
adminRoutes.post('/bookings/:id/cancel', async (c) => {
    const actor = c.get('adminActor');
    const booking = await getBookingDetail(c.env.DB, c.req.param('id'));
    if (!booking)
        return c.json({ success: false, error: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const result = await cancelBooking(c.env, booking, { byStaff: true, reason: body.reason || 'Cancelled by staff' });
    if (!result.success)
        return c.json({ success: false, error: result.error }, 400);
    await recordAuditLog(c.env.DB, actor, 'BOOKING_CANCEL', 'booking', booking.id, booking, result.booking, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, booking: result.booking });
});
/** Manually hand the next waitlisted customer a seat that opened outside the normal flow. */
adminRoutes.post('/slots/:id/promote-waitlist', async (c) => {
    const promoted = await promoteFromWaitlist(c.env, c.req.param('id'));
    return c.json({ success: true, promotedBookingId: promoted });
});
// --- 5.2 Blackout dates ----------------------------------------------------
adminRoutes.get('/blackouts', async (c) => {
    const { results } = await c.env.DB.prepare(`
    SELECT bo.*, e.name AS experience_name
    FROM experience_blackouts bo
    LEFT JOIN experiences e ON e.id = bo.experience_id
    ORDER BY bo.starts_at DESC LIMIT 200
  `).all();
    return c.json({ success: true, blackouts: results || [] });
});
adminRoutes.post('/blackouts', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json().catch(() => ({}));
    const startsAt = new Date(String(body.startsAt || ''));
    const endsAt = new Date(String(body.endsAt || ''));
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return c.json({ success: false, error: 'A blackout needs a valid start and a later end.' }, 400);
    }
    const id = newId('blk');
    await c.env.DB.prepare(`
    INSERT INTO experience_blackouts (id, experience_id, starts_at, ends_at, reason)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.experienceId || null, startsAt.toISOString(), endsAt.toISOString(), body.reason || null).run();
    await recordAuditLog(c.env.DB, actor, 'BLACKOUT_CREATE', 'experience_blackout', id, null, body, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, id });
});
adminRoutes.delete('/blackouts/:id', async (c) => {
    const actor = c.get('adminActor');
    await c.env.DB.prepare('DELETE FROM experience_blackouts WHERE id = ?').bind(c.req.param('id')).run();
    await recordAuditLog(c.env.DB, actor, 'BLACKOUT_DELETE', 'experience_blackout', c.req.param('id'), null, null, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true });
});
// --- Scheduled maintenance -------------------------------------------------
/**
 * Runs the three time-based sweeps this feature needs: T-24h reminders, stale-hold expiry, and
 * Stripe payment reconciliation.
 *
 * These belong on the cron in apps/api/src/index.ts, which this feature may not edit. Exposing
 * them behind the Zero Trust guard means they can be driven from outside (a Cloudflare cron
 * trigger hitting this URL, or an operator) until that wiring lands.
 */
adminRoutes.post('/maintenance/run', async (c) => {
    const horizon = Number(c.req.query('reminderHours')) || 24;
    const [remindersSent, holdsExpired, payments] = await Promise.all([
        sendDueReminders(c.env, horizon),
        expireStaleHolds(c.env),
        reconcilePendingPayments(c.env),
    ]);
    return c.json({
        success: true,
        remindersSent,
        holdsExpired,
        paymentsConfirmed: payments.confirmed,
        paymentsReleased: payments.released,
    });
});
experiencesApp.route('/admin', adminRoutes);
export { experiencesApp };
