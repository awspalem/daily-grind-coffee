/**
 * Entitlement engine (Phase 0 / register 4.2) against real SQLite and the real migrations.
 *
 * This is the contract between plans and bookings: a grant funds a seat instead of a payment.
 * Every failure mode here hands out something for nothing, so the tests are written around
 * balances and retries rather than return values alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer } from './helpers/d1';
import {
  consumeEntitlement,
  expireStaleGrants,
  getBalances,
  grantEntitlement,
  hasEntitlement,
  listActiveGrants,
  releaseEntitlement,
} from '../src/services/entitlements';

/** SQLite's own clock format, so a bound value is comparable with CURRENT_TIMESTAMP. */
function sqlTime(db: TestD1, offset: string): string {
  return db.get<{ t: string }>(`SELECT datetime('now', ?) AS t`, offset)!.t;
}

function setup() {
  const db = new TestD1();
  const customer = seedCustomer(db);
  return { db, customer };
}

test('entitlements: a grant funds a spend, and the balance falls by what was spent', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id,
    code: 'CONSULT_15MIN',
    totalUnits: 2,
    sourceType: 'SUBSCRIPTION',
    sourceId: 'sub_1',
    expiresAt: sqlTime(db, '+1 year'),
  });

  assert.equal(await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN', 2), true);
  assert.equal(await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN', 3), false);

  const spend = await consumeEntitlement(db as any, {
    customerId: customer.id,
    code: 'CONSULT_15MIN',
    reason: 'BOOKING_CONFIRMED',
    refType: 'BOOKING',
    refId: 'bk_1',
    idempotencyKey: 'booking:bk_1:consume',
  });
  assert.equal(spend.success, true);

  const balances = await getBalances(db as any, customer.id);
  const consult = balances.find((b) => b.entitlement_code === 'CONSULT_15MIN');
  assert.equal(consult?.remaining_units, 1);
});

test('entitlements: an overspend is refused rather than thrown, so the caller can charge instead', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id,
    code: 'TOUR_SEAT',
    totalUnits: 1,
    sourceType: 'SUBSCRIPTION',
    expiresAt: sqlTime(db, '+1 year'),
  });

  // Returning rather than throwing is the whole point: confirmBooking inspects `.success` and
  // falls through to the paid path. A throw here would 500 the booking instead.
  const spend = await consumeEntitlement(db as any, {
    customerId: customer.id,
    code: 'TOUR_SEAT',
    units: 2,
    reason: 'BOOKING_CONFIRMED',
    idempotencyKey: 'booking:bk_over:consume',
  });

  assert.equal(spend.success, false);
  assert.match(spend.error!, /Insufficient TOUR_SEAT/);

  // Nothing may have moved on a refused spend.
  const grant = db.get<{ used_units: number }>('SELECT used_units FROM entitlement_grants LIMIT 1')!;
  assert.equal(grant.used_units, 0);
  assert.equal(db.select('SELECT id FROM entitlement_ledger').length, 0);
});

test('entitlements: a retried spend reports the original and never debits twice', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id,
    code: 'CUPPING_SEAT',
    totalUnits: 4,
    sourceType: 'SUBSCRIPTION',
    expiresAt: sqlTime(db, '+1 year'),
  });

  const key = 'booking:bk_retry:consume';
  const first = await consumeEntitlement(db as any, {
    customerId: customer.id, code: 'CUPPING_SEAT', units: 2, reason: 'BOOKING_CONFIRMED', idempotencyKey: key,
  });
  const second = await consumeEntitlement(db as any, {
    customerId: customer.id, code: 'CUPPING_SEAT', units: 2, reason: 'BOOKING_CONFIRMED', idempotencyKey: key,
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.already_applied, true);

  const grant = db.get<{ used_units: number }>('SELECT used_units FROM entitlement_grants LIMIT 1')!;
  assert.equal(grant.used_units, 2, 'the retry must not have taken a second two units');
});

test('entitlements: a spend across two grants takes from the one expiring soonest first', async () => {
  const { db, customer } = setup();

  const later = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 2,
    sourceType: 'SUBSCRIPTION', sourceId: 'sub_later', expiresAt: sqlTime(db, '+2 years'),
  });
  const sooner = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 2,
    sourceType: 'SUBSCRIPTION', sourceId: 'sub_sooner', expiresAt: sqlTime(db, '+10 days'),
  });

  const spend = await consumeEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', units: 3, reason: 'BOOKING_CONFIRMED',
    idempotencyKey: 'booking:bk_split:consume',
  });
  assert.equal(spend.success, true);

  const soonerRow = db.get<{ used_units: number; status: string }>(
    'SELECT used_units, status FROM entitlement_grants WHERE id = ?', sooner.id
  )!;
  const laterRow = db.get<{ used_units: number; status: string }>(
    'SELECT used_units, status FROM entitlement_grants WHERE id = ?', later.id
  )!;

  assert.equal(soonerRow.used_units, 2, 'the grant about to lapse should be drained first');
  assert.equal(soonerRow.status, 'EXHAUSTED');
  assert.equal(laterRow.used_units, 1);
  assert.equal(laterRow.status, 'ACTIVE');

  // The second grant's ledger row carries a derived key: the UNIQUE index allows only one row
  // per key, so without the suffix the whole batch would fail and the spend would be lost.
  const keys = db
    .select<{ idempotency_key: string }>('SELECT idempotency_key FROM entitlement_ledger ORDER BY idempotency_key')
    .map((r) => r.idempotency_key);
  assert.deepEqual(keys, ['booking:bk_split:consume', 'booking:bk_split:consume:2']);
});

test('entitlements: a retried multi-grant spend still debits once', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', sourceId: 'a', expiresAt: sqlTime(db, '+10 days'),
  });
  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 3,
    sourceType: 'SUBSCRIPTION', sourceId: 'b', expiresAt: sqlTime(db, '+2 years'),
  });

  const key = 'booking:bk_multi:consume';
  await consumeEntitlement(db as any, { customerId: customer.id, code: 'TOUR_SEAT', units: 2, reason: 'BOOKING_CONFIRMED', idempotencyKey: key });
  await consumeEntitlement(db as any, { customerId: customer.id, code: 'TOUR_SEAT', units: 2, reason: 'BOOKING_CONFIRMED', idempotencyKey: key });

  const totalUsed = db.get<{ n: number }>('SELECT SUM(used_units) AS n FROM entitlement_grants')!.n;
  assert.equal(totalUsed, 2);
});

test('entitlements: releasing puts units back and reopens an exhausted grant', async () => {
  const { db, customer } = setup();

  const grant = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '+1 year'),
  });

  await consumeEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', reason: 'BOOKING_CONFIRMED',
    refType: 'BOOKING', refId: 'bk_2', idempotencyKey: 'booking:bk_2:consume',
  });
  assert.equal(
    db.get<{ status: string }>('SELECT status FROM entitlement_grants WHERE id = ?', grant.id)!.status,
    'EXHAUSTED'
  );

  const released = await releaseEntitlement(db as any, {
    customerId: customer.id, grantId: grant.id, code: 'CONSULT_15MIN',
    reason: 'BOOKING_CANCELLED', refType: 'BOOKING', refId: 'bk_2',
    idempotencyKey: 'booking:bk_2:release',
  });
  assert.equal(released.success, true);

  const after = db.get<{ used_units: number; status: string }>(
    'SELECT used_units, status FROM entitlement_grants WHERE id = ?', grant.id
  )!;
  assert.equal(after.used_units, 0);
  assert.equal(after.status, 'ACTIVE');
  assert.equal(await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN'), true);
});

test('entitlements: a retried release does not inflate the balance', async () => {
  const { db, customer } = setup();

  const grant = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', totalUnits: 2,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '+1 year'),
  });
  await consumeEntitlement(db as any, {
    customerId: customer.id, code: 'CONSULT_15MIN', units: 2, reason: 'BOOKING_CONFIRMED',
    idempotencyKey: 'booking:bk_3:consume',
  });

  const key = 'booking:bk_3:release';
  await releaseEntitlement(db as any, { customerId: customer.id, grantId: grant.id, code: 'CONSULT_15MIN', units: 2, reason: 'BOOKING_CANCELLED', idempotencyKey: key });
  await releaseEntitlement(db as any, { customerId: customer.id, grantId: grant.id, code: 'CONSULT_15MIN', units: 2, reason: 'BOOKING_CANCELLED', idempotencyKey: key });

  const after = db.get<{ used_units: number }>('SELECT used_units FROM entitlement_grants WHERE id = ?', grant.id)!;
  assert.equal(after.used_units, 0);
  assert.equal(db.select('SELECT id FROM entitlement_ledger WHERE delta_units > 0').length, 1);
});

test('entitlements: an unlimited grant spends without ever running down', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'FREE_SHIPPING', totalUnits: -1,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '+1 year'),
  });

  for (let i = 0; i < 3; i++) {
    const res = await consumeEntitlement(db as any, {
      customerId: customer.id, code: 'FREE_SHIPPING', reason: 'ORDER_PERK',
      refType: 'ORDER', refId: `ord_${i}`, idempotencyKey: `order:ord_${i}:shipping`,
    });
    assert.equal(res.success, true);
  }

  assert.equal(await hasEntitlement(db as any, customer.id, 'FREE_SHIPPING', 99), true);
  const balance = (await getBalances(db as any, customer.id)).find((b) => b.entitlement_code === 'FREE_SHIPPING');
  assert.equal(balance?.unlimited, true);
});

test('entitlements: a grant that has not started yet, and one already lapsed, are both inactive', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'EARLY_ACCESS', totalUnits: 1,
    sourceType: 'PROMO', startsAt: sqlTime(db, '+7 days'), expiresAt: sqlTime(db, '+30 days'),
  });
  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'ESTATE_VISIT', totalUnits: 1,
    sourceType: 'PROMO', startsAt: sqlTime(db, '-30 days'), expiresAt: sqlTime(db, '-1 day'),
  });

  assert.equal(await hasEntitlement(db as any, customer.id, 'EARLY_ACCESS'), false);
  assert.equal(await hasEntitlement(db as any, customer.id, 'ESTATE_VISIT'), false);
  assert.deepEqual(await listActiveGrants(db as any, customer.id), []);
});

test('entitlements: a grant issued now is immediately usable', async () => {
  const { db, customer } = setup();

  // Regression guard for a datetime-format mismatch: a grant whose `starts_at` is written by the
  // application (ISO 8601, with a 'T') but compared against CURRENT_TIMESTAMP (a space) sorts
  // above "now" as a string, and stays invisible until the following midnight UTC. Buying an
  // annual plan must hand over its perks at once, not tomorrow.
  await grantEntitlement(db as any, {
    customerId: customer.id,
    code: 'CONSULT_15MIN',
    totalUnits: 2,
    sourceType: 'SUBSCRIPTION',
    sourceId: 'sub_iso',
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
  });

  assert.equal(
    await hasEntitlement(db as any, customer.id, 'CONSULT_15MIN', 2),
    true,
    'a grant starting now must be spendable now'
  );
});

test('entitlements: expireStaleGrants marks lapsed grants and reports how many', async () => {
  const { db, customer } = setup();

  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '-2 days'),
  });
  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'CUPPING_SEAT', totalUnits: 1,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '+2 days'),
  });

  const expired = await expireStaleGrants(db as any);
  assert.equal(expired, 1, 'meta.changes must report the row count, or the cron reports nothing');

  const statuses = db.select<{ entitlement_code: string; status: string }>(
    'SELECT entitlement_code, status FROM entitlement_grants ORDER BY entitlement_code'
  );
  assert.deepEqual(statuses, [
    { entitlement_code: 'CUPPING_SEAT', status: 'ACTIVE' },
    { entitlement_code: 'TOUR_SEAT', status: 'EXPIRED' },
  ]);
});

test('entitlements: a lapsed grant written in ISO time is still expired by the cron', async () => {
  const { db, customer } = setup();

  // Same format mismatch from the other side: `expires_at` written as ISO and compared against
  // CURRENT_TIMESTAMP would leave a grant fundable for up to a day past its expiry.
  await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 1, sourceType: 'SUBSCRIPTION',
    startsAt: new Date(Date.now() - 40 * 86400_000).toISOString(),
    expiresAt: new Date(Date.now() - 3600_000).toISOString(),
  });

  assert.equal(await hasEntitlement(db as any, customer.id, 'TOUR_SEAT'), false);
  assert.equal(await expireStaleGrants(db as any), 1);
});

test('entitlements: a failing statement rolls the whole batch back', async () => {
  const { db, customer } = setup();

  const grant = await grantEntitlement(db as any, {
    customerId: customer.id, code: 'TOUR_SEAT', totalUnits: 2,
    sourceType: 'SUBSCRIPTION', expiresAt: sqlTime(db, '+1 year'),
  });

  // The ledger-plus-rollup invariant holds only because D1 runs a batch in one transaction.
  // A loop with no transaction would leave the first statement applied and the rollup stale.
  await assert.rejects(() =>
    db.batch([
      db.prepare(`
        INSERT INTO entitlement_ledger (id, grant_id, customer_id, entitlement_code, delta_units, reason, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind('entl_ok', grant.id, customer.id, 'TOUR_SEAT', -1, 'BOOKING_CONFIRMED', 'batch:atomic:1'),
      // Violates the NOT NULL on `reason`.
      db.prepare(`
        INSERT INTO entitlement_ledger (id, grant_id, customer_id, entitlement_code, delta_units, reason, idempotency_key)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).bind('entl_bad', grant.id, customer.id, 'TOUR_SEAT', -1, 'batch:atomic:2'),
    ] as any)
  );

  assert.equal(db.select('SELECT id FROM entitlement_ledger').length, 0, 'the first insert must have rolled back too');
});
