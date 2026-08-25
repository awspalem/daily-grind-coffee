/**
 * Loyalty ledger (register 2.1–2.5) against real SQLite.
 *
 * Points are money: 1 point is worth ₹0.50 off a future order. The invariant these tests defend
 * is that the balance is always `SUM(points_delta)` over the ledger and that no client-retryable
 * path can write that sum twice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer } from './helpers/d1';
import {
  LOYALTY_RATES,
  awardForDeliveredOrder,
  creditPoints,
  describeTier,
  getBalance,
  getStatement,
  getSummary,
  pointsForSpend,
  pointsToCents,
  prepareOrderRedemption,
  previewRedemption,
  refreshCustomerLoyalty,
  reverseOrder,
  tierForSpend,
} from '../src/services/loyalty';

function setup() {
  const db = new TestD1();
  const customer = seedCustomer(db);
  return { db, customer };
}

/** Puts points in the bank without going through an order. */
async function credit(db: TestD1, customerId: string, points: number, key: string) {
  return creditPoints(db as any, {
    customerId, points, entryType: 'EARN', reason: 'ADMIN_ADJUST', idempotencyKey: key,
  });
}

function seedOrder(
  db: TestD1,
  customer: { id: string; email: string },
  id: string,
  fields: { status?: string; subtotal?: number; discount?: number; createdAt?: string } = {}
) {
  db.run(
    `INSERT INTO orders (id, order_number, customer_id, customer_email, status, subtotal_cents,
                         discount_cents, shipping_cents, tax_cents, total_cents, currency,
                         shipping_address_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'inr', '{}', COALESCE(?, CURRENT_TIMESTAMP))`,
    id, `TDG-${id}`, customer.id, customer.email,
    fields.status ?? 'DELIVERED',
    fields.subtotal ?? 100_000,
    fields.discount ?? 0,
    (fields.subtotal ?? 100_000) - (fields.discount ?? 0),
    fields.createdAt ?? null
  );
}

// ---------------------------------------------------------------- earning

test('loyalty: the rate is 1 point per ₹10, multiplied by tier', () => {
  assert.equal(pointsForSpend(100_000), 100);          // ₹1,000 → 100 points at Bronze
  assert.equal(pointsForSpend(100_000, 'SILVER'), 125);
  assert.equal(pointsForSpend(100_000, 'GOLD'), 150);
  assert.equal(pointsForSpend(0), 0);
  assert.equal(pointsForSpend(-500), 0, 'a negative net must never earn');
});

test('loyalty: a delivered order earns on the net of discounts, once', async () => {
  const { db, customer } = setup();
  seedOrder(db, customer, 'ord_earn', { subtotal: 200_000, discount: 50_000 });

  const loyaltyCustomer = (await refreshCustomerLoyalty(db as any, customer.id))!;
  const first = await awardForDeliveredOrder(db as any, loyaltyCustomer, {
    id: 'ord_earn', subtotal_cents: 200_000, discount_cents: 50_000,
  });
  const second = await awardForDeliveredOrder(db as any, loyaltyCustomer, {
    id: 'ord_earn', subtotal_cents: 200_000, discount_cents: 50_000,
  });

  assert.equal(first, 150, '₹1,500 net at Bronze');
  assert.equal(second, 0, 'a re-delivered webhook must not pay twice');

  // The first read of a customer with an empty ledger backfills the legacy signup bonus as a
  // real EARN row, so the balance is the award plus that one-off. Asserted explicitly: it is the
  // bridge from the old `customers.loyalty_points` stub to the ledger, and it must happen once.
  assert.equal(await getBalance(db as any, customer.id), 150 + LOYALTY_RATES.SIGNUP_BONUS_POINTS);
  assert.equal(
    db.select("SELECT id FROM loyalty_ledger WHERE reason = 'SIGNUP_BONUS'").length,
    1,
    'the signup bonus must be backfilled exactly once'
  );
});

test('loyalty: the rollup on customers matches the ledger sum', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 500, 'k1');
  await credit(db, customer.id, 250, 'k2');

  await refreshCustomerLoyalty(db as any, customer.id);
  const row = db.get<{ loyalty_points: number; loyalty_points_lifetime: number }>(
    'SELECT loyalty_points, loyalty_points_lifetime FROM customers WHERE id = ?', customer.id
  )!;
  const ledgerSum = db.get<{ n: number }>(
    'SELECT COALESCE(SUM(points_delta), 0) AS n FROM loyalty_ledger WHERE customer_id = ?', customer.id
  )!.n;

  assert.equal(row.loyalty_points, ledgerSum);
  assert.equal(row.loyalty_points, 750);
  assert.equal(row.loyalty_points_lifetime, 750);
});

// ---------------------------------------------------------------- redemption

test('loyalty: redemption is refused below the points floor', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, LOYALTY_RATES.MIN_REDEEM_POINTS - 1, 'k1');

  const preview = await previewRedemption(db as any, customer.id, 500_000);
  assert.equal(preview.eligible, false);
  assert.equal(preview.max_points, 0);
  assert.match(preview.reason!, /at least/);
});

test('loyalty: redemption is capped at a percentage of the basket, not the balance', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 100_000, 'k1'); // far more than any basket allows

  const subtotal = 100_000; // ₹1,000
  const preview = await previewRedemption(db as any, customer.id, subtotal);

  const capCents = Math.floor((subtotal * LOYALTY_RATES.MAX_REDEEM_PERCENT) / 100);
  assert.equal(preview.eligible, true);
  assert.equal(preview.max_discount_cents, capCents);
  assert.ok(preview.max_points < 100_000, 'the cap, not the balance, must bind');
  assert.equal(preview.max_points, Math.floor(capCents / LOYALTY_RATES.POINT_VALUE_CENTS));
});

test('loyalty: a basket too small to reach the floor is refused', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 5_000, 'k1');

  // 20% of ₹100 is ₹20 — 40 points, under the 200-point floor.
  const preview = await previewRedemption(db as any, customer.id, 10_000);
  assert.equal(preview.eligible, false);
  assert.match(preview.reason!, /too small/);
});

test('loyalty: a redemption debits exactly once however many times checkout retries', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 5_000, 'k1');
  seedOrder(db, customer, 'ord_redeem', { status: 'PENDING_PAYMENT', subtotal: 500_000 });

  const first = await prepareOrderRedemption(db as any, customer.id, 'ord_redeem', 1_000, 500_000);
  assert.equal(first.success, true);
  assert.equal(first.discountCents, pointsToCents(first.points));
  await db.batch(first.statements);

  const balanceAfter = await getBalance(db as any, customer.id);
  assert.equal(balanceAfter, 5_000 - first.points);

  // The shopper double-taps "Pay". The UNIQUE idempotency key must absorb the second write.
  const retry = await prepareOrderRedemption(db as any, customer.id, 'ord_redeem', 1_000, 500_000);
  await db.batch(retry.statements);

  assert.equal(await getBalance(db as any, customer.id), balanceAfter, 'a retried checkout must not debit twice');
  assert.equal(
    db.select("SELECT id FROM loyalty_ledger WHERE reason = 'ORDER_REDEEM'").length,
    1
  );
});

test('loyalty: a redemption cannot exceed what the preview allows', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 5_000, 'k1');
  seedOrder(db, customer, 'ord_greedy', { status: 'PENDING_PAYMENT', subtotal: 200_000 });

  // Asking for the whole balance against a ₹2,000 basket: the 20% cap must clamp it.
  const result = await prepareOrderRedemption(db as any, customer.id, 'ord_greedy', 5_000, 200_000);
  assert.equal(result.success, true);
  assert.ok(result.discountCents <= 200_000 * LOYALTY_RATES.MAX_REDEEM_PERCENT / 100);
  assert.ok(result.points < 5_000);
});

test('loyalty: points spent on a refunded order come back, and points earned are clawed back', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 5_000, 'k1');
  seedOrder(db, customer, 'ord_refund', { status: 'PENDING_PAYMENT', subtotal: 500_000 });

  const redemption = await prepareOrderRedemption(db as any, customer.id, 'ord_refund', 1_000, 500_000);
  await db.batch(redemption.statements);

  const loyaltyCustomer = (await refreshCustomerLoyalty(db as any, customer.id))!;
  const earned = await awardForDeliveredOrder(db as any, loyaltyCustomer, {
    id: 'ord_refund', subtotal_cents: 500_000, discount_cents: 0,
  });
  assert.ok(earned > 0);

  const balanceBefore = await getBalance(db as any, customer.id);
  const reversal = await reverseOrder(db as any, customer.id, 'ord_refund');

  assert.equal(reversal.clawedBack, earned);
  assert.equal(reversal.restored, redemption.points);
  assert.equal(
    await getBalance(db as any, customer.id),
    balanceBefore - earned + redemption.points
  );
});

test('loyalty: a retried refund reverses once', async () => {
  const { db, customer } = setup();
  seedOrder(db, customer, 'ord_twice', { subtotal: 500_000 });
  const loyaltyCustomer = (await refreshCustomerLoyalty(db as any, customer.id))!;
  await awardForDeliveredOrder(db as any, loyaltyCustomer, { id: 'ord_twice', subtotal_cents: 500_000, discount_cents: 0 });

  await reverseOrder(db as any, customer.id, 'ord_twice');
  const balance = await getBalance(db as any, customer.id);
  await reverseOrder(db as any, customer.id, 'ord_twice');

  assert.equal(await getBalance(db as any, customer.id), balance);
});

// ---------------------------------------------------------------- expiry

test('loyalty: lapsed lots expire on read and the statement records it', async () => {
  const { db, customer } = setup();

  await creditPoints(db as any, {
    customerId: customer.id, points: 800, entryType: 'EARN', reason: 'ORDER_DELIVERED',
    idempotencyKey: 'old-lot', expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  await credit(db, customer.id, 200, 'fresh-lot');

  // Expiry is lazy: it is evaluated the next time the customer is read, not by a cron.
  const summary = (await getSummary(db as any, customer.id))!;
  assert.equal(summary.balance, 200, 'the lapsed lot must be gone');

  const statement = await getStatement(db as any, customer.id, 50, 0);
  const expiry = statement.find((e) => e.reason === 'POINTS_EXPIRED');
  assert.ok(expiry, 'the customer must be able to see why points vanished');
  assert.equal(expiry!.points_delta, -800);
});

test('loyalty: expiry never drives the balance below what the ledger holds', async () => {
  const { db, customer } = setup();

  await creditPoints(db as any, {
    customerId: customer.id, points: 500, entryType: 'EARN', reason: 'ORDER_DELIVERED',
    idempotencyKey: 'lot-a', expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  // A refund clawback can take the balance below what the open lots still show.
  await creditPoints(db as any, {
    customerId: customer.id, points: 400, entryType: 'ADJUST', reason: 'REFUND_CLAWBACK',
    idempotencyKey: 'clawback', expiresAt: null,
  });
  db.run("UPDATE loyalty_ledger SET points_delta = -400 WHERE idempotency_key = 'clawback'");

  const summary = (await getSummary(db as any, customer.id))!;
  assert.equal(summary.balance, 0, 'clamped to the authoritative balance, never negative from expiry');
});

// ---------------------------------------------------------------- tiers

test('loyalty: tier boundaries are inclusive at the threshold', () => {
  const { SILVER, GOLD } = LOYALTY_RATES.TIER_THRESHOLDS_CENTS;

  assert.equal(tierForSpend(0), 'BRONZE');
  assert.equal(tierForSpend(SILVER - 1), 'BRONZE');
  assert.equal(tierForSpend(SILVER), 'SILVER');
  assert.equal(tierForSpend(GOLD - 1), 'SILVER');
  assert.equal(tierForSpend(GOLD), 'GOLD');
});

test('loyalty: the tier description reports the gap to the next tier, and none at the top', () => {
  const { SILVER, GOLD } = LOYALTY_RATES.TIER_THRESHOLDS_CENTS;

  const bronze = describeTier('BRONZE', 0);
  assert.equal(bronze.next_tier, 'SILVER');
  assert.equal(bronze.cents_to_next_tier, SILVER);

  const silver = describeTier('SILVER', SILVER);
  assert.equal(silver.next_tier, 'GOLD');
  assert.equal(silver.cents_to_next_tier, GOLD - SILVER);

  const gold = describeTier('GOLD', GOLD + 1);
  assert.equal(gold.next_tier, null);
  assert.equal(gold.cents_to_next_tier, 0);
  assert.ok(gold.perks.length > 0);
});

test('loyalty: only delivered orders inside twelve months count towards the tier', async () => {
  const { db, customer } = setup();

  seedOrder(db, customer, 'ord_recent', { subtotal: 1_200_000 });
  seedOrder(db, customer, 'ord_old', {
    subtotal: 5_000_000,
    createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19),
  });
  seedOrder(db, customer, 'ord_pending', { status: 'PENDING_PAYMENT', subtotal: 9_000_000 });

  const summary = (await getSummary(db as any, customer.id))!;
  assert.equal(summary.tier.trailing_spend_cents, 1_200_000);
  assert.equal(summary.tier.tier, 'SILVER', 'the old and unpaid orders must not promote anyone');
});

// ---------------------------------------------------------------- abandoned checkout

test('loyalty: points held by an abandoned checkout are returned', async () => {
  const { db, customer } = setup();
  await credit(db, customer.id, 5_000, 'k1');
  seedOrder(db, customer, 'ord_abandoned', { status: 'PENDING_PAYMENT', subtotal: 500_000 });

  const redemption = await prepareOrderRedemption(db as any, customer.id, 'ord_abandoned', 1_000, 500_000);
  await db.batch(redemption.statements);
  const afterHold = await getBalance(db as any, customer.id);

  // Age the order past the hold window; the shopper never paid.
  db.run(
    "UPDATE orders SET created_at = datetime('now', ?), loyalty_points_redeemed = ? WHERE id = 'ord_abandoned'",
    `-${LOYALTY_RATES.REDEMPTION_HOLD_MINUTES + 10} minutes`,
    redemption.points
  );

  const summary = (await getSummary(db as any, customer.id))!;
  assert.equal(summary.balance, afterHold + redemption.points, 'an abandoned basket must not burn points');

  const order = db.get<{ loyalty_points_redeemed: number }>(
    "SELECT loyalty_points_redeemed FROM orders WHERE id = 'ord_abandoned'"
  )!;
  assert.equal(order.loyalty_points_redeemed, 0, 'the hold must be cleared, or it would be reclaimed again');
});
