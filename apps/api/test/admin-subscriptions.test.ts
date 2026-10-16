/**
 * Admin subscription operator endpoints (commit 6a42189) against real SQLite.
 *
 * These four routes let roastery staff pause / resume / skip / cancel *any* subscription — no
 * ownership check, unlike the customer routes. What they add on top of the shared service
 * functions is a set of status guards (404 missing, 400 illegal transition, idempotent success
 * when already in the target state) and an `audit_log` row per successful mutation. Those guards
 * and that audit row are the contract worth defending here, so the routes are mounted on a
 * one-off Hono app and driven with `app.request`, matching customer-auth.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { Env } from '../src/types/env';
import { TestD1, seedCustomer, seedProductVariant } from './helpers/d1';
import { adminApp } from '../src/routes/admin';
import { addDays } from '../src/services/subscriptionPlans';

const DAY = 86_400_000;

function makeApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/admin', adminApp);
  return app;
}

function envFor(db: TestD1): Env {
  // Non-production with no ADMIN_TOKEN set: the zero-trust guard lets the request through with a
  // local-dev admin actor, which is all these route tests need.
  return {
    DB: db as any,
    ENVIRONMENT: 'test',
    STOREFRONT_URL: 'https://dailyroast.in',
    ADMIN_URL: 'https://admin.dailyroast.in',
    CURRENCY: 'inr',
  } as Env;
}

async function post(
  app: Hono<{ Bindings: Env }>,
  db: TestD1,
  path: string,
  body?: unknown
): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    envFor(db)
  );
}

function setup() {
  const db = new TestD1();
  const customer = seedCustomer(db);
  // subscriptions.variant_id is a RESTRICT foreign key, so a real variant has to exist.
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
    status: 'ACTIVE',
    frequency: '2_WEEKS',
    quantity: 1,
    unit_price_cents: 95_000,
    discount_percent: 15,
    next_renewal_date: new Date(Date.now() + 14 * DAY).toISOString(),
    plan_id: null as string | null,
    plan_term: null as string | null,
    ...fields,
  };

  db.run(
    `INSERT INTO subscriptions (id, customer_email, customer_id, variant_id, product_name, grind_type,
                                frequency, quantity, unit_price_cents, discount_percent, status,
                                next_renewal_date, plan_id, plan_term)
     VALUES (?, ?, ?, 'var_test', 'Test Lot', 'WHOLE_BEAN', ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, customer.email, customer.id, row.frequency, row.quantity, row.unit_price_cents,
    row.discount_percent, row.status, row.next_renewal_date, row.plan_id, row.plan_term
  );

  return db.get<any>('SELECT * FROM subscriptions WHERE id = ?', row.id)!;
}

const subRow = (db: TestD1) => db.get<any>("SELECT * FROM subscriptions WHERE id = 'sub_test'")!;
const auditRows = (db: TestD1, action?: string) =>
  db.select<any>(
    `SELECT * FROM audit_log WHERE entity_id = 'sub_test'${action ? ' AND action = ?' : ''} ORDER BY id`,
    ...(action ? [action] : [])
  );

// ---------------------------------------------------------------- pause / resume

test('admin subscriptions: pause then resume cycles ACTIVE -> PAUSED -> ACTIVE with an audit row each', async () => {
  const { db, customer } = setup();
  seedSubscription(db, customer, { status: 'ACTIVE' });
  const app = makeApp();

  const pause = await post(app, db, '/api/admin/subscriptions/sub_test/pause');
  assert.equal(pause.status, 200);
  assert.equal((await pause.json()).success, true);
  assert.equal(subRow(db).status, 'PAUSED');
  assert.ok(subRow(db).paused_at, 'paused_at is stamped on pause');
  assert.equal(auditRows(db, 'PAUSE_SUBSCRIPTION').length, 1);

  const resume = await post(app, db, '/api/admin/subscriptions/sub_test/resume');
  assert.equal(resume.status, 200);
  assert.equal(subRow(db).status, 'ACTIVE', 'a non-annual sub returns to ACTIVE, not PREPAID');
  assert.equal(subRow(db).paused_at, null, 'paused_at is cleared on resume');
  assert.equal(auditRows(db, 'RESUME_SUBSCRIPTION').length, 1);
});

test('admin subscriptions: pausing an already-paused sub is idempotent and writes no second audit row', async () => {
  const { db, customer } = setup();
  seedSubscription(db, customer, { status: 'ACTIVE' });
  const app = makeApp();

  await post(app, db, '/api/admin/subscriptions/sub_test/pause');
  const pausedAt = subRow(db).paused_at;

  const again = await post(app, db, '/api/admin/subscriptions/sub_test/pause');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).success, true);
  assert.equal(subRow(db).paused_at, pausedAt, 'the second pause must not re-stamp paused_at');
  assert.equal(
    auditRows(db, 'PAUSE_SUBSCRIPTION').length,
    1,
    'the idempotent early-return happens before recordAuditLog'
  );
});

test('admin subscriptions: resume rejects a sub that is not paused', async () => {
  const { db, customer } = setup();
  seedSubscription(db, customer, { status: 'ACTIVE' });
  const app = makeApp();

  const res = await post(app, db, '/api/admin/subscriptions/sub_test/resume');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
  assert.equal(subRow(db).status, 'ACTIVE');
  assert.equal(auditRows(db).length, 0);
});

// ---------------------------------------------------------------- skip

test('admin subscriptions: skip moves next_renewal_date forward exactly one cycle', async () => {
  const { db, customer } = setup();
  const original = new Date(Date.now() + 5 * DAY).toISOString();
  seedSubscription(db, customer, { status: 'ACTIVE', frequency: '2_WEEKS', next_renewal_date: original });
  const app = makeApp();

  const res = await post(app, db, '/api/admin/subscriptions/sub_test/skip');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.next_renewal_date, addDays(original, 14));
  assert.equal(subRow(db).next_renewal_date, addDays(original, 14));
  assert.equal(auditRows(db, 'SKIP_SUBSCRIPTION_DELIVERY').length, 1);
});

// ---------------------------------------------------------------- cancel

test('admin subscriptions: cancel is terminal — pause/resume/skip all 400 afterwards', async () => {
  const { db, customer } = setup();
  seedSubscription(db, customer, { status: 'ACTIVE' });
  const app = makeApp();

  const cancel = await post(app, db, '/api/admin/subscriptions/sub_test/cancel', { reason: 'moved abroad' });
  assert.equal(cancel.status, 200);
  assert.equal(subRow(db).status, 'CANCELLED');
  assert.equal(subRow(db).cancel_reason, 'moved abroad');
  assert.equal(auditRows(db, 'CANCEL_SUBSCRIPTION').length, 1);

  for (const action of ['pause', 'resume', 'skip']) {
    const res = await post(app, db, `/api/admin/subscriptions/sub_test/${action}`);
    assert.equal(res.status, 400, `${action} on a cancelled sub must be rejected`);
  }
  assert.equal(subRow(db).status, 'CANCELLED');
});

test('admin subscriptions: cancel with no body falls back to the staff reason and is idempotent', async () => {
  const { db, customer } = setup();
  seedSubscription(db, customer, { status: 'ACTIVE' });
  const app = makeApp();

  const first = await post(app, db, '/api/admin/subscriptions/sub_test/cancel');
  assert.equal(first.status, 200);
  assert.equal(subRow(db).cancel_reason, 'Cancelled by roastery staff');

  const cancelledAt = subRow(db).cancelled_at;
  const again = await post(app, db, '/api/admin/subscriptions/sub_test/cancel');
  assert.equal(again.status, 200);
  assert.equal((await again.json()).success, true);
  assert.equal(subRow(db).cancelled_at, cancelledAt, 'the second cancel must not re-stamp cancelled_at');
  assert.equal(
    auditRows(db, 'CANCEL_SUBSCRIPTION').length,
    1,
    'the idempotent early-return happens before recordAuditLog'
  );
});

// ---------------------------------------------------------------- missing row

test('admin subscriptions: every operator action 404s on an unknown subscription id', async () => {
  const { db } = setup();
  const app = makeApp();

  for (const action of ['pause', 'resume', 'skip', 'cancel']) {
    const res = await post(app, db, `/api/admin/subscriptions/sub_missing/${action}`);
    assert.equal(res.status, 404, `${action} must 404`);
    assert.equal((await res.json()).success, false);
  }
  assert.equal(db.select("SELECT id FROM audit_log").length, 0);
});
