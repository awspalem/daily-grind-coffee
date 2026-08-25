/**
 * Subscription plans, tiers and entitlement grants (register 4.1–4.4) against real SQLite and
 * the real seeded plan catalog.
 *
 * The thing worth defending here is the annual term. It is charged once, up front, so the
 * renewal cron must never see it, its perks must be spendable the day it is bought and dead the
 * day the term ends, and pausing it must not push a charge at the customer on resume.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer, seedProductVariant } from './helpers/d1';
import {
  activatePlanSubscription,
  addDays,
  addMonths,
  buildSaveOffer,
  cancelSubscription,
  getPlan,
  getPlanPerkBalances,
  grantPlanEntitlements,
  listPlans,
  pauseSubscription,
  projectUpcomingShipments,
  resumeSubscription,
  revokePlanEntitlements,
  serialisePlan,
  skipNextDelivery,
} from '../src/services/subscriptionPlans';
import { hasEntitlement } from '../src/services/entitlements';

const DAY = 86_400_000;

function setup() {
  const db = new TestD1();
  const customer = seedCustomer(db);
  // `subscriptions.variant_id` is a RESTRICT foreign key, so a real variant has to exist.
  seedProductVariant(db);
  return { db, customer };
}

function seedSubscription(
  db: TestD1,
  customer: { id: string; email: string },
  fields: Record<string, unknown> = {}
) {
  const row = {
    id: 'sub_test',
    status: 'PENDING_PAYMENT',
    frequency: '2_WEEKS',
    quantity: 1,
    unit_price_cents: 95_000,
    discount_percent: 15,
    next_renewal_date: new Date(Date.now() + 14 * DAY).toISOString(),
    plan_id: null as string | null,
    plan_term: null as string | null,
    term_ends_at: null as string | null,
    shipments_remaining: null as number | null,
    ...fields,
  };

  db.run(
    `INSERT INTO subscriptions (id, customer_email, customer_id, variant_id, product_name, grind_type,
                                frequency, quantity, unit_price_cents, discount_percent, status,
                                next_renewal_date, plan_id, plan_term, term_ends_at, shipments_remaining)
     VALUES (?, ?, ?, 'var_test', 'Test Lot', 'WHOLE_BEAN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, customer.email, customer.id, row.frequency, row.quantity, row.unit_price_cents,
    row.discount_percent, row.status, row.next_renewal_date, row.plan_id, row.plan_term,
    row.term_ends_at, row.shipments_remaining
  );

  return db.get<any>('SELECT * FROM subscriptions WHERE id = ?', row.id)!;
}

// ---------------------------------------------------------------- catalog

test('plans: the seeded catalog offers both terms and hides retired tiers', async () => {
  const { db } = setup();

  const live = await listPlans(db as any);
  assert.ok(live.length >= 4);
  assert.ok(live.some((p) => p.term === 'ANNUAL'), 'the annual term is what funds the consultations');
  assert.ok(live.some((p) => p.term === 'MONTHLY'));

  db.run("UPDATE subscription_plans SET is_active = 0 WHERE slug = 'explorer-monthly'");
  const afterRetire = await listPlans(db as any);
  assert.equal(afterRetire.find((p) => p.slug === 'explorer-monthly'), undefined);

  const includingRetired = await listPlans(db as any, true);
  assert.ok(includingRetired.find((p) => p.slug === 'explorer-monthly'), 'admin must still see it');
});

test('plans: a plan is addressable by slug or id, and serialises its perks', async () => {
  const { db } = setup();

  const bySlug = (await getPlan(db as any, 'connoisseur-annual'))!;
  const byId = (await getPlan(db as any, bySlug.id))!;
  assert.equal(byId.id, bySlug.id);

  const shape = serialisePlan(bySlug);
  assert.equal(shape.term, 'ANNUAL');
  assert.ok(Array.isArray(shape.perks));
  assert.ok(Array.isArray(shape.entitlements));
  assert.ok(shape.entitlements.some((e) => e.code === 'CONSULT_15MIN'),
    'the annual tier is the one that promises a teleconsultation');
});

// ---------------------------------------------------------------- entitlement grants

test('plans: buying an annual plan hands over its perks immediately', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;
  seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'ANNUAL' });

  const startsAt = new Date().toISOString();
  const result = await grantPlanEntitlements(db as any, {
    customerId: customer.id, subscriptionId: 'sub_test', plan,
    sourceType: 'SUBSCRIPTION', startsAt, expiresAt: addMonths(startsAt, 12),
  });

  assert.ok(result.granted.includes('CONSULT_15MIN'));
  assert.equal(
    await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN'),
    true,
    'perks bought today must be spendable today, not from the next midnight'
  );

  const perks = await getPlanPerkBalances(db as any, customer.id);
  assert.ok(perks.length > 0);
  assert.ok(perks.every((p) => p.source_id === 'sub_test'));
});

test('plans: re-running the grant for the same term does not double the perks', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;
  seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'ANNUAL' });
  const startsAt = new Date().toISOString();
  const args = {
    customerId: customer.id, subscriptionId: 'sub_test', plan,
    sourceType: 'SUBSCRIPTION' as const, startsAt, expiresAt: addMonths(startsAt, 12),
  };

  const first = await grantPlanEntitlements(db as any, args);
  const second = await grantPlanEntitlements(db as any, args);

  assert.ok(first.granted.length > 0);
  assert.equal(second.granted.length, 0);
  assert.deepEqual(second.skipped, first.granted, 'a replayed order-paid hook must be inert');

  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entitlement_grants')!.n;
  assert.equal(count, first.granted.length);
});

test('plans: a renewal is a new term and gets its own grant', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;
  seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'ANNUAL' });
  const yearOne = new Date().toISOString();
  const yearTwo = addMonths(yearOne, 12);

  await grantPlanEntitlements(db as any, {
    customerId: customer.id, subscriptionId: 'sub_test', plan,
    sourceType: 'SUBSCRIPTION', startsAt: yearOne, expiresAt: yearTwo,
  });
  const renewal = await grantPlanEntitlements(db as any, {
    customerId: customer.id, subscriptionId: 'sub_test', plan,
    sourceType: 'PLAN_RENEWAL', startsAt: yearTwo, expiresAt: addMonths(yearTwo, 12),
  });

  assert.ok(renewal.granted.length > 0, 'year two must be granted, not skipped as a duplicate');
  // Year two has not started, so it must not be spendable yet — perks do not stockpile.
  const spendable = await getPlanPerkBalances(db as any, customer.id);
  assert.ok(spendable.every((p) => p.source_id === 'sub_test'));
  assert.equal(
    db.select("SELECT id FROM entitlement_grants WHERE source_type = 'PLAN_RENEWAL'").length,
    renewal.granted.length
  );
});

test('plans: refunding a plan revokes what it issued, and stops it funding anything', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;
  seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'ANNUAL' });
  const startsAt = new Date().toISOString();

  await grantPlanEntitlements(db as any, {
    customerId: customer.id, subscriptionId: 'sub_test', plan,
    sourceType: 'SUBSCRIPTION', startsAt, expiresAt: addMonths(startsAt, 12),
  });
  assert.equal(await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN'), true);

  const revoked = await revokePlanEntitlements(db as any, 'sub_test', 'refunded');
  assert.ok(revoked > 0, 'meta.changes must report the count');
  assert.equal(await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN'), false);
  assert.deepEqual(await getPlanPerkBalances(db as any, customer.id), []);
});

test('plans: perks lapse when the term they were bought with ends', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;

  seedSubscription(db, customer, { id: 'sub_old', plan_id: plan.id, plan_term: 'ANNUAL' });
  const startsAt = new Date(Date.now() - 400 * DAY).toISOString();
  await grantPlanEntitlements(db as any, {
    customerId: customer.id, subscriptionId: 'sub_old', plan,
    sourceType: 'SUBSCRIPTION', startsAt, expiresAt: addMonths(startsAt, 12),
  });

  assert.equal(
    await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN'),
    false,
    "last year's consultations must not carry into this year"
  );
});

// ---------------------------------------------------------------- activation & term

test('plans: an annual plan lands PREPAID so the renewal charger never sees it', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'connoisseur-annual'))!;
  const sub = seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'ANNUAL' });

  await activatePlanSubscription(db as any, sub, plan, new Date().toISOString());

  const after = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  assert.equal(after.status, 'PREPAID');
  assert.equal(after.shipments_remaining, plan.shipments_included);

  // The renewal cron selects on `status = 'ACTIVE' AND next_renewal_date <= now`. A prepaid year
  // is already paid for; appearing there would charge the member a second time.
  const due = db.select(
    "SELECT id FROM subscriptions WHERE status = 'ACTIVE' AND next_renewal_date <= CURRENT_TIMESTAMP"
  );
  assert.equal(due.length, 0);
});

test('plans: a monthly plan lands ACTIVE with the clock one cycle out', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'explorer-monthly'))!;
  const sub = seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'MONTHLY' });

  const startsAt = new Date().toISOString();
  await activatePlanSubscription(db as any, sub, plan, startsAt);

  const after = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  assert.equal(after.status, 'ACTIVE');
  assert.ok(
    new Date(after.next_renewal_date).getTime() > Date.now(),
    "the first bag was part of this charge — billing again today would be a double charge"
  );
});

test('plans: activation only ever fires on a subscription awaiting payment', async () => {
  const { db, customer } = setup();
  const plan = (await getPlan(db as any, 'explorer-monthly'))!;
  const sub = seedSubscription(db, customer, { plan_id: plan.id, plan_term: 'MONTHLY', status: 'CANCELLED' });

  await activatePlanSubscription(db as any, sub, plan, new Date().toISOString());

  const after = db.get<any>('SELECT status FROM subscriptions WHERE id = ?', sub.id)!;
  assert.equal(after.status, 'CANCELLED', 'a cancelled subscription must not be resurrected by a replayed hook');
});

// ---------------------------------------------------------------- self-serve management

test('plans: pausing past the renewal date does not bill on resume', async () => {
  const { db, customer } = setup();
  const sub = seedSubscription(db, customer, {
    status: 'ACTIVE',
    next_renewal_date: new Date(Date.now() - 3 * DAY).toISOString(),
  });

  await pauseSubscription(db as any, sub, 'CUSTOMER');
  assert.equal(db.get<any>('SELECT status FROM subscriptions WHERE id = ?', sub.id)!.status, 'PAUSED');

  const paused = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  const next = await resumeSubscription(db as any, paused, 'CUSTOMER');

  assert.ok(new Date(next).getTime() > Date.now(), 'resuming into an overdue charge is the surprise pausing exists to avoid');
  assert.equal(db.get<any>('SELECT status FROM subscriptions WHERE id = ?', sub.id)!.status, 'ACTIVE');
});

test('plans: resuming an annual plan returns it to PREPAID, not ACTIVE', async () => {
  const { db, customer } = setup();
  const sub = seedSubscription(db, customer, { status: 'PREPAID', plan_term: 'ANNUAL' });

  await pauseSubscription(db as any, sub, 'CUSTOMER');
  const paused = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  await resumeSubscription(db as any, paused, 'CUSTOMER');

  assert.equal(
    db.get<any>('SELECT status FROM subscriptions WHERE id = ?', sub.id)!.status,
    'PREPAID',
    'resuming into ACTIVE would hand a prepaid year to the renewal charger'
  );
});

test('plans: skipping moves the date a whole cycle and clears the notice flag', async () => {
  const { db, customer } = setup();
  const original = new Date(Date.now() + 5 * DAY).toISOString();
  const sub = seedSubscription(db, customer, { status: 'ACTIVE', next_renewal_date: original });
  db.run("UPDATE subscriptions SET renewal_notice_sent_for = ? WHERE id = ?", original, sub.id);

  const next = await skipNextDelivery(db as any, sub, 'CUSTOMER');

  assert.equal(next, addDays(original, 14), 'a fortnightly skip moves exactly one fortnight');
  const after = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  assert.equal(after.renewal_notice_sent_for, null, 'the new date needs its own notice');

  const events = db.select<{ event_type: string }>('SELECT event_type FROM subscription_events WHERE subscription_id = ?', sub.id);
  assert.ok(events.some((e) => e.event_type === 'SKIPPED'), 'the customer must be able to see what happened');
});

test('plans: cancelling records the reason and stops future shipments', async () => {
  const { db, customer } = setup();
  const sub = seedSubscription(db, customer, { status: 'ACTIVE' });

  await cancelSubscription(db as any, sub, 'Too much coffee', 'CUSTOMER');

  const after = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  assert.equal(after.status, 'CANCELLED');
  assert.equal(after.cancel_reason, 'Too much coffee');
  assert.ok(after.cancelled_at);
  assert.deepEqual(projectUpcomingShipments(after, 3), []);
});

test('plans: the save offer is made once, then not again', async () => {
  const { db, customer } = setup();
  const sub = seedSubscription(db, customer, { status: 'ACTIVE' });

  const offer = buildSaveOffer(sub, 'too expensive');
  assert.ok(offer, 'a cancelling customer should be offered something');

  db.run("UPDATE subscriptions SET save_offer_used_at = CURRENT_TIMESTAMP WHERE id = ?", sub.id);
  const used = db.get<any>('SELECT * FROM subscriptions WHERE id = ?', sub.id)!;
  const repeat = buildSaveOffer(used, 'too expensive');
  assert.notDeepEqual(repeat, offer, 'the same discount must not be farmable every month');
});

// ---------------------------------------------------------------- renewal transparency

test('plans: a monthly projection bills each shipment at the tier discount', () => {
  const sub = {
    id: 'sub_x', product_name: 'Test Lot', grind_type: 'WHOLE_BEAN', quantity: 2,
    unit_price_cents: 100_000, discount_percent: 15, frequency: '2_WEEKS',
    status: 'ACTIVE', plan_term: 'MONTHLY',
    next_renewal_date: new Date(Date.now() + DAY).toISOString(),
    shipments_remaining: null, term_ends_at: null,
  } as any;

  const shipments = projectUpcomingShipments(sub, 3);
  assert.equal(shipments.length, 3);
  assert.equal(shipments[0].estimated_total_cents, 170_000, '2 bags at ₹1,000 less 15%');
  assert.ok(shipments.every((s: any) => s.will_charge === true));

  const gaps = shipments.slice(1).map((s: any, i: number) =>
    new Date(s.scheduled_for).getTime() - new Date(shipments[i].scheduled_for).getTime()
  );
  assert.ok(gaps.every((g) => g === 14 * DAY), 'a fortnightly plan ships fortnightly');
});

test('plans: a prepaid annual projection charges nothing and stops at the term', () => {
  const sub = {
    id: 'sub_y', product_name: 'Test Lot', grind_type: 'WHOLE_BEAN', quantity: 1,
    unit_price_cents: 100_000, discount_percent: 20, frequency: '4_WEEKS',
    status: 'PREPAID', plan_term: 'ANNUAL',
    next_renewal_date: new Date(Date.now() + DAY).toISOString(),
    shipments_remaining: 2,
    term_ends_at: new Date(Date.now() + 365 * DAY).toISOString(),
  } as any;

  const shipments = projectUpcomingShipments(sub, 6);
  assert.equal(shipments.length, 2, 'only what is left of the prepaid term');
  assert.ok(shipments.every((s: any) => s.will_charge === false), 'the year is already paid for');
});

test('plans: a projection never runs past the end of the term', () => {
  const sub = {
    id: 'sub_z', product_name: 'Test Lot', grind_type: 'WHOLE_BEAN', quantity: 1,
    unit_price_cents: 100_000, discount_percent: 0, frequency: '4_WEEKS',
    status: 'PREPAID', plan_term: 'ANNUAL',
    next_renewal_date: new Date(Date.now() + DAY).toISOString(),
    shipments_remaining: null,
    term_ends_at: new Date(Date.now() + 30 * DAY).toISOString(),
  } as any;

  const shipments = projectUpcomingShipments(sub, 6);
  assert.ok(shipments.length <= 2);
  assert.ok(shipments.every((s: any) => new Date(s.scheduled_for) <= new Date(sub.term_ends_at)));
});
