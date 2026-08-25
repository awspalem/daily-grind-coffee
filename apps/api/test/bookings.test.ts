/**
 * Bookable experiences (register 5.1–5.6) against real SQLite and the real seeded catalog.
 *
 * A slot is inventory: the guard against selling the same seat twice is a SQL predicate
 * (`seats_booked + ? <= seats_total`) applied inside a batch, exactly as `inventory_movements`
 * guards stock. That predicate is what these tests exercise — a stub that returns success for
 * every write would report an oversold cupping table as a healthy booking.
 *
 * Every Stripe-touching path is deliberately out of scope: the payment provider is undecided.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer, testEnv } from './helpers/d1';
import {
  cancelBooking,
  confirmBooking,
  createBooking,
  expireStaleHolds,
  getBookingDetail,
  getExperience,
  listAvailableSlots,
  markAttendance,
  promoteFromWaitlist,
  rescheduleBooking,
  seatPriceCents,
  withinCancellationWindow,
} from '../src/services/bookings';
import { getBalances, grantEntitlement } from '../src/services/entitlements';

const HOURS = 3600_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function setup(slugOrOpts: string | { slug?: string; seats?: number; startsIn?: number } = {}) {
  const opts = typeof slugOrOpts === 'string' ? { slug: slugOrOpts } : slugOrOpts;
  const db = new TestD1();
  const customer = seedCustomer(db);
  const env = testEnv(db);

  const experience = (await getExperience(db as any, opts.slug ?? 'roastery-tour'))!;
  const startsAt = iso(opts.startsIn ?? 30 * 24 * HOURS);
  const slotId = 'slot_test';
  db.run(
    `INSERT INTO experience_slots (id, experience_id, starts_at, ends_at, seats_total, seats_booked, status)
     VALUES (?, ?, ?, ?, ?, 0, 'OPEN')`,
    slotId, experience.id, startsAt,
    new Date(new Date(startsAt).getTime() + 90 * 60_000).toISOString(),
    opts.seats ?? 2
  );
  const slot = db.get<any>('SELECT * FROM experience_slots WHERE id = ?', slotId)!;

  return { db, env, customer, experience, slot };
}

function otherCustomer(db: TestD1, n: number) {
  return seedCustomer(db, `cust_${n}`, `guest${n}@example.com`);
}

function seats(db: TestD1, slotId = 'slot_test') {
  return db.get<{ seats_booked: number; seats_total: number }>(
    'SELECT seats_booked, seats_total FROM experience_slots WHERE id = ?', slotId
  )!;
}

// ---------------------------------------------------------------- capacity

test('bookings: a hold takes a seat off the slot', async () => {
  const { db, customer, experience, slot } = await setup();

  const res = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);

  assert.equal(res.success, true);
  assert.equal(res.waitlisted, false);
  assert.equal(res.booking!.status, 'HOLD');
  assert.equal(seats(db).seats_booked, 1);
});

test('bookings: the slot cannot be oversold — the overflow is waitlisted, not seated', async () => {
  const { db, customer, experience, slot } = await setup({ seats: 1 });

  const first = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  const second = await createBooking(db as any, {
    experience, slot, customerId: otherCustomer(db, 2).id, customerEmail: 'guest2@example.com', partySize: 1,
  } as any);

  assert.equal(first.booking!.status, 'HOLD');
  assert.equal(second.success, true);
  assert.equal(second.waitlisted, true, 'a full slot must waitlist rather than error');
  assert.equal(second.booking!.status, 'WAITLISTED');

  const s = seats(db);
  assert.equal(s.seats_booked, 1);
  assert.ok(s.seats_booked <= s.seats_total, 'seats_booked must never exceed seats_total');
});

test('bookings: a party larger than the remaining seats is waitlisted whole', async () => {
  const { db, customer, experience, slot } = await setup({ seats: 3 });
  db.run("UPDATE experiences SET max_party_size = 4 WHERE id = ?", experience.id);
  const roomy = (await getExperience(db as any, experience.id))!;

  await createBooking(db as any, {
    experience: roomy, slot, customerId: customer.id, customerEmail: customer.email, partySize: 2,
  } as any);
  const fresh = db.get<any>('SELECT * FROM experience_slots WHERE id = ?', slot.id)!;

  // 2 of 3 taken; a party of 2 does not fit and must not be split across the boundary.
  const big = await createBooking(db as any, {
    experience: roomy, slot: fresh, customerId: otherCustomer(db, 3).id,
    customerEmail: 'guest3@example.com', partySize: 2,
  } as any);

  assert.equal(big.waitlisted, true);
  assert.equal(seats(db).seats_booked, 2, 'a partial seating would oversell by one');
});

test('bookings: a retried booking returns the original rather than taking a second seat', async () => {
  const { db, customer, experience, slot } = await setup({ seats: 5 });

  const key = 'book:once';
  const first = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1, idempotencyKey: key,
  } as any);
  const retry = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1, idempotencyKey: key,
  } as any);

  assert.equal(retry.reused, true);
  assert.equal(retry.booking!.id, first.booking!.id);
  assert.equal(seats(db).seats_booked, 1);
});

test('bookings: a slot that has already started, or is not open, refuses new bookings', async () => {
  const past = await setup({ startsIn: -2 * HOURS });
  const started = await createBooking(past.db as any, {
    experience: past.experience, slot: past.slot, customerId: past.customer.id,
    customerEmail: past.customer.email, partySize: 1,
  } as any);
  assert.equal(started.success, false);
  assert.match(started.error!, /already started/);

  const closed = await setup();
  closed.db.run("UPDATE experience_slots SET status = 'CANCELLED' WHERE id = 'slot_test'");
  const cancelledSlot = closed.db.get<any>("SELECT * FROM experience_slots WHERE id = 'slot_test'")!;
  const res = await createBooking(closed.db as any, {
    experience: closed.experience, slot: cancelledSlot, customerId: closed.customer.id,
    customerEmail: closed.customer.email, partySize: 1,
  } as any);
  assert.equal(res.success, false);
  assert.match(res.error!, /no longer open/);
});

test('bookings: a full slot is still listed, so the storefront can offer the waitlist', async () => {
  const { db, customer, experience, slot } = await setup({ seats: 1 });
  await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);

  // Deliberately not filtered on capacity: routes/experiences.ts serialises `is_full` and
  // `seats_available` so a sold-out date can be shown with a join-the-waitlist action rather
  // than vanishing from the calendar.
  const listed = await listAvailableSlots(db as any, experience.id);
  const full = listed.find((s: any) => s.id === slot.id);
  assert.ok(full, 'a sold-out slot must remain visible');
  assert.equal(full!.seats_total - full!.seats_booked, 0);
});

test('bookings: a cancelled slot and a blacked-out date are both withheld', async () => {
  const cancelled = await setup();
  cancelled.db.run("UPDATE experience_slots SET status = 'CANCELLED' WHERE id = 'slot_test'");
  assert.equal((await listAvailableSlots(cancelled.db as any, cancelled.experience.id)).length, 0);

  const blacked = await setup();
  blacked.db.run(
    `INSERT INTO experience_blackouts (id, experience_id, starts_at, ends_at, reason)
     VALUES ('blk_1', ?, ?, ?, 'Roastery closed')`,
    blacked.experience.id, iso(29 * 24 * HOURS), iso(31 * 24 * HOURS)
  );
  assert.equal((await listAvailableSlots(blacked.db as any, blacked.experience.id)).length, 0);
});

// ---------------------------------------------------------------- funding

test('bookings: an entitlement funds the seat and is spent exactly once', async () => {
  const { db, env, customer, experience, slot } = await setup('barista-teleconsultation');
  assert.equal(experience.entitlement_code, 'CONSULT_15MIN', 'the seeded consult must be entitlement-funded');

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 2,
    sourceType: 'SUBSCRIPTION', sourceId: 'sub_1',
    expiresAt: new Date(Date.now() + 365 * 24 * HOURS).toISOString(),
  });

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);

  const confirmed = await confirmBooking(env, held.booking!, {} as any);
  assert.equal(confirmed.success, true);
  assert.equal(confirmed.fundingSource, 'ENTITLEMENT');
  assert.equal(confirmed.booking!.status, 'CONFIRMED');

  const balance = (await getBalances(db as any, customer.id)).find((b) => b.entitlement_code === 'CONSULT_15MIN');
  assert.equal(balance!.remaining_units, 1);

  // Double-tapping Confirm must not burn a second credit.
  await confirmBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, {} as any);
  const after = (await getBalances(db as any, customer.id)).find((b) => b.entitlement_code === 'CONSULT_15MIN');
  assert.equal(after!.remaining_units, 1);
});

test('bookings: with no entitlement left, confirmation does not silently hand over a free seat', async () => {
  const { db, env, customer, experience, slot } = await setup('barista-teleconsultation');

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);

  // No grant exists. Whatever the fallback does about payment, it may not report the booking as
  // funded by an entitlement it never had.
  const confirmed = await confirmBooking(env, held.booking!, {} as any);
  assert.notEqual(confirmed.fundingSource, 'ENTITLEMENT');

  assert.equal(
    db.select("SELECT id FROM entitlement_ledger WHERE ref_id = ?", held.booking!.id).length,
    0,
    'nothing may be debited when there is nothing to debit'
  );
});

// ---------------------------------------------------------------- cancellation

test('bookings: cancelling inside the window frees the seat and returns the entitlement', async () => {
  const { db, env, customer, experience, slot } = await setup('barista-teleconsultation');

  const grant = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: new Date(Date.now() + 365 * 24 * HOURS).toISOString(),
  });

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  await confirmBooking(env, held.booking!, {} as any);
  assert.equal(seats(db).seats_booked, 1);

  const cancelled = await cancelBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, {});
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.entitlementRestored, true);
  assert.equal(seats(db).seats_booked, 0, 'the seat must go back on sale');

  const after = db.get<{ used_units: number }>('SELECT used_units FROM entitlement_grants WHERE id = ?', grant.id)!;
  assert.equal(after.used_units, 0);
});

test('bookings: cancelling past the cutoff is refused, and staff can override', async () => {
  const { db, env, customer, experience, slot } = await setup({ slug: 'roastery-tour', startsIn: 2 * HOURS });

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  const booking = (await getBookingDetail(db as any, held.booking!.id))!;
  assert.ok(booking.cancellation_cutoff_hours > 2, 'fixture assumes the cutoff is already past');

  const refused = await cancelBooking(env, booking, {});
  assert.equal(refused.success, false);
  assert.match(refused.error!, /cancellation closed/i);
  assert.equal(seats(db).seats_booked, 1, 'a refused cancellation must not release the seat');

  // The roastery calling it off is not bound by the customer's policy window.
  const byStaff = await cancelBooking(env, booking, { byStaff: true, reason: 'Roaster unwell' });
  assert.equal(byStaff.success, true);
  assert.equal(seats(db).seats_booked, 0);
});

test('bookings: an already-closed booking cannot be cancelled twice', async () => {
  const { db, env, customer, experience, slot } = await setup();

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  await cancelBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, { byStaff: true });
  const again = await cancelBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, { byStaff: true });

  assert.equal(again.success, false);
  assert.equal(seats(db).seats_booked, 0, 'a second cancel must not double-release the seat');
});

test('bookings: the cancellation window is measured against the start time', () => {
  assert.equal(withinCancellationWindow(iso(48 * HOURS), 24), true);
  assert.equal(withinCancellationWindow(iso(2 * HOURS), 24), false);
  assert.equal(withinCancellationWindow(iso(-1 * HOURS), 24), false);
});

// ---------------------------------------------------------------- holds & waitlist

test('bookings: an abandoned hold expires, releases its seat and promotes the waitlist', async () => {
  const { db, env, customer, experience, slot } = await setup({ seats: 1 });

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  const waiting = await createBooking(db as any, {
    experience, slot, customerId: otherCustomer(db, 9).id, customerEmail: 'guest9@example.com', partySize: 1,
  } as any);
  assert.equal(waiting.waitlisted, true);

  // Nothing here waits on wall-clock time; the hold is aged directly.
  db.run("UPDATE bookings SET hold_expires_at = ? WHERE id = ?", iso(-60_000), held.booking!.id);

  const expired = await expireStaleHolds(env);
  assert.equal(expired, 1);
  assert.equal(
    db.get<{ status: string }>('SELECT status FROM bookings WHERE id = ?', held.booking!.id)!.status,
    'EXPIRED'
  );

  const promoted = db.get<{ status: string }>('SELECT status FROM bookings WHERE id = ?', waiting.booking!.id)!;
  assert.equal(promoted.status, 'WAITLIST_OFFERED', 'the freed seat must be offered to whoever was waiting');
});

test('bookings: a confirmed booking is never expired by the hold sweep', async () => {
  const { db, env, customer, experience, slot } = await setup('barista-teleconsultation');

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: new Date(Date.now() + 365 * 24 * HOURS).toISOString(),
  });
  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  await confirmBooking(env, held.booking!, {} as any);

  db.run("UPDATE bookings SET hold_expires_at = ? WHERE id = ?", iso(-60_000), held.booking!.id);
  assert.equal(await expireStaleHolds(env), 0);
  assert.equal(
    db.get<{ status: string }>('SELECT status FROM bookings WHERE id = ?', held.booking!.id)!.status,
    'CONFIRMED'
  );
});

test('bookings: promoting from an empty waitlist is a no-op', async () => {
  const { env, slot } = await setup();
  assert.equal(await promoteFromWaitlist(env, slot.id), null);
});

// ---------------------------------------------------------------- reschedule & attendance

test('bookings: rescheduling moves the seat between slots without leaking one', async () => {
  const { db, env, customer, experience, slot } = await setup({ seats: 2 });

  db.run(
    `INSERT INTO experience_slots (id, experience_id, starts_at, ends_at, seats_total, seats_booked, status)
     VALUES ('slot_b', ?, ?, ?, 2, 0, 'OPEN')`,
    experience.id, iso(45 * 24 * HOURS), iso(45 * 24 * HOURS + 90 * 60_000)
  );

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  assert.equal(seats(db).seats_booked, 1);

  const target = db.get<any>("SELECT * FROM experience_slots WHERE id = 'slot_b'")!;
  const moved = await rescheduleBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, target);
  assert.equal(moved.success, true);

  assert.equal(seats(db, 'slot_test').seats_booked, 0, 'the original seat must be given back');
  assert.equal(seats(db, 'slot_b').seats_booked, 1, 'and taken on the new slot');
});

test('bookings: attendance and no-show are recorded on the booking', async () => {
  const { db, env, customer, experience, slot } = await setup('barista-teleconsultation');

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: new Date(Date.now() + 365 * 24 * HOURS).toISOString(),
  });
  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  await confirmBooking(env, held.booking!, {} as any);

  assert.equal(await markAttendance(db as any, held.booking!.id, 'ATTENDED', 'Lovely session'), true);
  const row = db.get<{ status: string; attended_at: string | null; staff_notes: string | null }>(
    'SELECT status, attended_at, staff_notes FROM bookings WHERE id = ?', held.booking!.id
  )!;
  assert.equal(row.status, 'COMPLETED');
  assert.ok(row.attended_at);
  assert.equal(row.staff_notes, 'Lovely session');

  // Re-marking is allowed on purpose — staff mis-click, and the roster is the only place to fix
  // it. What must not happen is marking a booking that was never confirmed.
  assert.equal(await markAttendance(db as any, held.booking!.id, 'NO_SHOW', null), true);
  const corrected = db.get<{ status: string; attended_at: string | null; no_show_at: string | null }>(
    'SELECT status, attended_at, no_show_at FROM bookings WHERE id = ?', held.booking!.id
  )!;
  assert.equal(corrected.status, 'NO_SHOW');
  assert.equal(corrected.attended_at, null, 'the two outcomes are exclusive');
  assert.ok(corrected.no_show_at);
});

test('bookings: a cancelled booking cannot be marked as attended', async () => {
  const { db, env, customer, experience, slot } = await setup();

  const held = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  await cancelBooking(env, (await getBookingDetail(db as any, held.booking!.id))!, { byStaff: true });

  assert.equal(await markAttendance(db as any, held.booking!.id, 'ATTENDED', null), false);
});

// ---------------------------------------------------------------- pricing

test('bookings: a slot price override wins over the catalog price', async () => {
  const { experience, slot } = await setup();
  assert.equal(seatPriceCents(experience, slot), experience.price_cents);
  assert.equal(seatPriceCents(experience, { ...slot, price_cents_override: 99_900 } as any), 99_900);
  assert.equal(seatPriceCents(experience, { ...slot, price_cents_override: 0 } as any), 0, 'a free slot is not "no override"');
});
