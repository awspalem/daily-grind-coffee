/**
 * Notification channels (register 6.2 / 6.10 / 6.12): per-channel consent, the back-in-stock
 * sweep, Web Push subscription storage, and the second booking-reminder milestone.
 *
 * Runs against the SQLite-backed D1 helper with every real migration applied, so the consent
 * default policy, the `ON CONFLICT` upserts and the restock join are all exercised as written.
 * `fetch` is stubbed where a send would otherwise leave the DB in the "not sent" branch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer, seedProductVariant, testEnv } from './helpers/d1';
import { customerApp } from '../src/routes/customer';
import { productsApp } from '../src/routes/products';
import {
  getConsentMap,
  hasConsent,
  setConsent,
  notifyBackInStock,
} from '../src/services/notifications';
import { createBooking, getExperience, sendDueReminders } from '../src/services/bookings';
import { sendPush, pushToCustomer } from '../src/services/webPush';

async function realVapidConfig() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    VAPID_PUBLIC_KEY: Buffer.from(rawPub).toString('base64url'),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    VAPID_SUBJECT: 'mailto:ops@dailyroast.in',
  };
}

const HOUR = 3600_000;

/** Replaces global fetch for the duration of `fn`, capturing the calls made. */
async function withStubbedFetch(
  handler: (url: string, init?: any) => Response | Promise<Response>,
  fn: () => Promise<void>
): Promise<{ url: string; init?: any }[]> {
  const calls: { url: string; init?: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as any;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

function seedSession(db: TestD1, customerId: string, token = 'sess_tok'): string {
  db.run(
    `INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`,
    token, customerId
  );
  return token;
}

function setStock(db: TestD1, variantId: string, sku: string, available: number): void {
  db.run(
    `INSERT INTO inventory (variant_id, sku, available_stock) VALUES (?, ?, ?)
     ON CONFLICT(variant_id) DO UPDATE SET available_stock = excluded.available_stock`,
    variantId, sku, available
  );
}

// --------------------------------------------------------------- consent

test('consent: unset channels fall back to the default policy', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);

  const map = await getConsentMap(env, id);
  assert.equal(map.marketing_email, false, 'marketing is opt-out — silent by default');
  assert.equal(map.product_news, false);
  assert.equal(map.back_in_stock, true, 'joining a waitlist is the opt-in — default on');
  assert.equal(map.push, true);
});

test('consent: setConsent upserts and getConsentMap reflects it', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);

  assert.equal(await setConsent(env, id, 'marketing_email', true), true);
  assert.equal(await setConsent(env, id, 'back_in_stock', false), true);
  // second write to the same channel updates rather than duplicating
  assert.equal(await setConsent(env, id, 'marketing_email', false), true);

  const map = await getConsentMap(env, id);
  assert.equal(map.marketing_email, false);
  assert.equal(map.back_in_stock, false);
  assert.equal(await hasConsent(env, id, 'back_in_stock'), false);

  const rows = db.select('SELECT * FROM customer_channel_consent WHERE customer_id = ?', id);
  assert.equal(rows.length, 2, 'one row per channel, not per write');
});

test('consent: unknown channel names are rejected, not stored', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);

  assert.equal(await setConsent(env, id, 'sms_blast', true), false);
  assert.equal(db.select('SELECT * FROM customer_channel_consent').length, 0);
});

test('consent API: GET returns the map, PUT applies a partial update', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);
  const token = seedSession(db, id);

  const put = await customerApp.request('/notifications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Session': token },
    body: JSON.stringify({ preferences: { marketing_email: true, bogus: true } }),
  }, env);
  assert.equal(put.status, 200);
  const putBody = await put.json() as any;
  assert.equal(putBody.applied, 1, 'only the known channel counts');
  assert.equal(putBody.preferences.marketing_email, true);

  const get = await customerApp.request('/notifications', {
    headers: { 'X-Customer-Session': token },
  }, env);
  const getBody = await get.json() as any;
  assert.equal(getBody.preferences.marketing_email, true);
  assert.equal(getBody.preferences.back_in_stock, true);
});

test('consent API: rejects an unauthenticated caller', async () => {
  const db = new TestD1();
  const res = await customerApp.request('/notifications', {}, testEnv(db));
  assert.equal(res.status, 401);
});

// --------------------------------------------------------------- notify-me

test('notify-me: an out-of-stock variant creates a pending waitlist row', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { variantId } = seedProductVariant(db);
  setStock(db, variantId, 'TDG-TEST-var_test', 0);

  const res = await productsApp.request('/products/notify-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant_id: variantId, email: 'Wants@Example.com' }),
  }, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, in_stock: false });

  const row = db.get<any>('SELECT * FROM stock_notifications WHERE variant_id = ?', variantId);
  assert.equal(row.email, 'wants@example.com', 'email is normalised to lower-case');
  assert.equal(row.notified_at, null);
});

test('notify-me: a variant already in stock is a no-op', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { variantId } = seedProductVariant(db);
  setStock(db, variantId, 'TDG-TEST-var_test', 5);

  const res = await productsApp.request('/products/notify-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant_id: variantId, email: 'a@b.com' }),
  }, env);
  assert.deepEqual(await res.json(), { success: true, in_stock: true });
  assert.equal(db.select('SELECT * FROM stock_notifications').length, 0);
});

test('notify-me: an unknown variant is a 404', async () => {
  const db = new TestD1();
  const res = await productsApp.request('/products/notify-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant_id: 'nope', email: 'a@b.com' }),
  }, testEnv(db));
  assert.equal(res.status, 404);
});

test('notify-me: re-subscribing after a restock re-arms the row', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { variantId } = seedProductVariant(db);
  setStock(db, variantId, 'TDG-TEST-var_test', 0);

  const body = JSON.stringify({ variant_id: variantId, email: 'again@example.com' });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  await productsApp.request('/products/notify-me', opts, env);
  db.run('UPDATE stock_notifications SET notified_at = CURRENT_TIMESTAMP WHERE variant_id = ?', variantId);
  await productsApp.request('/products/notify-me', { ...opts, body }, env);

  const rows = db.select<any>('SELECT * FROM stock_notifications WHERE variant_id = ?', variantId);
  assert.equal(rows.length, 1, 'still one row — upsert on (variant_id, email)');
  assert.equal(rows[0].notified_at, null, 're-subscribe cleared the stamp');
});

// --------------------------------------------------------------- back-in-stock sweep

test('notifyBackInStock: emails waiters once a variant is restocked, then stamps them', async () => {
  const db = new TestD1();
  const env = testEnv(db, { RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'The Daily Roast <x@dailyroast.in>' });
  const { variantId } = seedProductVariant(db);
  setStock(db, variantId, 'TDG-TEST-var_test', 0);

  db.run(
    `INSERT INTO stock_notifications (id, variant_id, email) VALUES ('stk_1', ?, 'waiter@example.com')`,
    variantId
  );

  // Still out of stock — the sweep does nothing.
  let sent = 0;
  await withStubbedFetch(() => new Response('{}', { status: 200 }), async () => {
    sent = await notifyBackInStock(env);
  });
  assert.equal(sent, 0);

  // Restock, then sweep.
  setStock(db, variantId, 'TDG-TEST-var_test', 8);
  const calls = await withStubbedFetch(
    () => new Response('{"id":"ok"}', { status: 200 }),
    async () => { sent = await notifyBackInStock(env); }
  );
  assert.equal(sent, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.resend\.com/);

  const row = db.get<any>('SELECT notified_at FROM stock_notifications WHERE id = ?', 'stk_1');
  assert.notEqual(row.notified_at, null);

  // Idempotent — a second sweep sends nothing.
  await withStubbedFetch(() => new Response('{}', { status: 200 }), async () => {
    sent = await notifyBackInStock(env);
  });
  assert.equal(sent, 0);
});

test('notifyBackInStock: a customer who opted out is skipped but still stamped', async () => {
  const db = new TestD1();
  const env = testEnv(db, { RESEND_API_KEY: 'test-key' });
  const { id: customerId } = seedCustomer(db, 'cust_optout', 'optout@example.com');
  const { variantId } = seedProductVariant(db);
  setStock(db, variantId, 'TDG-TEST-var_test', 4);
  await setConsent(env, customerId, 'back_in_stock', false);

  db.run(
    `INSERT INTO stock_notifications (id, variant_id, email, customer_id)
     VALUES ('stk_2', ?, 'optout@example.com', ?)`,
    variantId, customerId
  );

  let sent = 1;
  const calls = await withStubbedFetch(
    () => new Response('{}', { status: 200 }),
    async () => { sent = await notifyBackInStock(env); }
  );
  assert.equal(sent, 0, 'suppressed by consent');
  assert.equal(calls.length, 0, 'no email attempted');
  const row = db.get<any>('SELECT notified_at FROM stock_notifications WHERE id = ?', 'stk_2');
  assert.notEqual(row.notified_at, null, 'stamped so it leaves the queue');
});

// --------------------------------------------------------------- web push

test('push subscribe: stores the subscription and upserts on repeat', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);
  const token = seedSession(db, id);

  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p1', auth: 'a1' } };
  const first = await customerApp.request('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Session': token },
    body: JSON.stringify({ subscription: sub }),
  }, env);
  assert.equal(first.status, 200);

  // Same endpoint again, new keys — one row, updated in place.
  await customerApp.request('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Session': token },
    body: JSON.stringify({ subscription: { ...sub, keys: { p256dh: 'p2', auth: 'a2' } } }),
  }, env);

  const rows = db.select<any>('SELECT * FROM push_subscriptions WHERE customer_id = ?', id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].p256dh, 'p2');
});

test('push subscribe: a malformed body is a 400', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const token = seedSession(db, seedCustomer(db).id);
  const res = await customerApp.request('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Session': token },
    body: JSON.stringify({ subscription: { endpoint: 'https://push.example/x' } }),
  }, env);
  assert.equal(res.status, 400);
});

test('push unsubscribe: removes the row by endpoint, no auth needed', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth) VALUES ('push_1', ?, 'https://push.example/gone', 'p', 'a')`,
    id
  );
  const res = await customerApp.request('/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://push.example/gone' }),
  }, env);
  assert.equal(res.status, 200);
  assert.equal(db.select('SELECT * FROM push_subscriptions').length, 0);
});

test('consent: switching push off clears every device this customer registered', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);
  const other = seedCustomer(db, 'cust_other', 'someone.else@example.com');
  const token = seedSession(db, id);

  // Two devices for this customer, plus an unrelated customer's device that must survive.
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth) VALUES ('push_a', ?, 'https://push.example/a', 'p', 'a')`,
    id
  );
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth) VALUES ('push_b', ?, 'https://push.example/b', 'p', 'a')`,
    id
  );
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth) VALUES ('push_c', ?, 'https://push.example/c', 'p', 'a')`,
    other.id
  );

  // Opting out from device A alone — the storefront can only unsubscribe the browser it runs in.
  const res = await customerApp.request('/notifications', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Session': token },
    body: JSON.stringify({ preferences: { push: false } }),
  }, env);
  assert.equal(res.status, 200);

  assert.equal(db.select('SELECT * FROM push_subscriptions WHERE customer_id = ?', id).length, 0);
  assert.equal(db.select('SELECT * FROM push_subscriptions WHERE customer_id = ?', other.id).length, 1);
  assert.equal(await hasConsent(env, id, 'push'), false);
});

test('consent: switching push back on leaves subscriptions to the browser to re-register', async () => {
  const db = new TestD1();
  const env = testEnv(db);
  const { id } = seedCustomer(db);
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth) VALUES ('push_a', ?, 'https://push.example/a', 'p', 'a')`,
    id
  );

  await setConsent(env, id, 'push', true);
  assert.equal(db.select('SELECT * FROM push_subscriptions WHERE customer_id = ?', id).length, 1);

  // ...and an opt-out on a *different* channel never touches them.
  await setConsent(env, id, 'marketing_email', false);
  assert.equal(db.select('SELECT * FROM push_subscriptions WHERE customer_id = ?', id).length, 1);
});

test('push vapid-key: 503 without config, the key with it', async () => {
  const db = new TestD1();
  const without = await customerApp.request('/push/vapid-key', {}, testEnv(db));
  assert.equal(without.status, 503);

  const withKey = await customerApp.request('/push/vapid-key', {}, testEnv(db, { VAPID_PUBLIC_KEY: 'BPUBLICKEY' }));
  assert.equal(withKey.status, 200);
  assert.equal((await withKey.json() as any).vapid_public_key, 'BPUBLICKEY');
});

test('sendPush: signs a real VAPID JWT and reports a dead subscription as gone', async () => {
  // A real P-256 keypair so the ECDSA import + sign path actually runs.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const publicKey = Buffer.from(rawPub).toString('base64url');
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const cfg = { publicKey, privateJwk, subject: 'mailto:ops@dailyroast.in' };

  let seenAuth = '';
  const calls = await withStubbedFetch((_url, init) => {
    seenAuth = init.headers.Authorization;
    return new Response('gone', { status: 410 });
  }, async () => {
    const r = await sendPush(cfg, 'https://push.example/sub-1');
    assert.equal(r.ok, false);
    assert.equal(r.gone, true);
  });
  assert.equal(calls.length, 1);
  assert.match(seenAuth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/, 'a three-part JWT and the public key');
});

test('pushToCustomer: a soft failure bumps the counter, then prunes after repeats', async () => {
  const db = new TestD1();
  const env = testEnv(db, await realVapidConfig());
  const { id } = seedCustomer(db);
  db.run(
    `INSERT INTO push_subscriptions (id, customer_id, endpoint, p256dh, auth, failure_count)
     VALUES ('push_f', ?, 'https://push.example/soft', 'p', 'a', 0)`,
    id
  );

  const bump = async () => {
    await withStubbedFetch(() => new Response('err', { status: 500 }), async () => {
      await pushToCustomer(env, id);
    });
  };

  await bump();
  assert.equal(db.get<any>("SELECT failure_count FROM push_subscriptions WHERE id = 'push_f'").failure_count, 1);
  await bump(); await bump(); await bump(); // now at 4
  assert.equal(db.get<any>("SELECT failure_count FROM push_subscriptions WHERE id = 'push_f'").failure_count, 4);
  await bump(); // failure_count >= 4 → pruned
  assert.equal(db.select("SELECT * FROM push_subscriptions WHERE id = 'push_f'").length, 0);
});

// --------------------------------------------------------------- booking reminders

async function confirmedBookingDueIn(offsetMs: number) {
  const db = new TestD1();
  const env = testEnv(db, { RESEND_API_KEY: 'test-key' });
  const customer = seedCustomer(db);
  const experience = (await getExperience(db as any, 'roastery-tour'))!;
  const startsAt = new Date(Date.now() + offsetMs).toISOString();
  db.run(
    `INSERT INTO experience_slots (id, experience_id, starts_at, ends_at, seats_total, seats_booked, status)
     VALUES ('slot_r', ?, ?, ?, 4, 0, 'OPEN')`,
    experience.id, startsAt, new Date(Date.now() + offsetMs + 90 * 60_000).toISOString()
  );
  const slot = db.get<any>('SELECT * FROM experience_slots WHERE id = ?', 'slot_r')!;
  const res = await createBooking(db as any, {
    experience, slot, customerId: customer.id, customerEmail: customer.email, partySize: 1,
  } as any);
  db.run("UPDATE bookings SET status = 'CONFIRMED' WHERE id = ?", res.booking!.id);
  return { db, env, bookingId: res.booking!.id };
}

test('reminders: the 24h and 1h milestones fire independently', async () => {
  const { db, env, bookingId } = await confirmedBookingDueIn(40 * 60_000); // 40 min out — inside both windows

  let sent24 = 0, sent1 = 0;
  await withStubbedFetch(() => new Response('{"id":"ok"}', { status: 200 }), async () => {
    sent24 = await sendDueReminders(env, { milestone: '24h' });
    sent1 = await sendDueReminders(env, { milestone: '1h' });
  });

  assert.equal(sent24, 1);
  assert.equal(sent1, 1, 'the 1h reminder is not suppressed by the 24h one');

  const row = db.get<any>('SELECT reminder_sent_at, reminder_1h_sent_at FROM bookings WHERE id = ?', bookingId);
  assert.notEqual(row.reminder_sent_at, null);
  assert.notEqual(row.reminder_1h_sent_at, null);

  // Re-running sends nothing — both stamps are set.
  await withStubbedFetch(() => new Response('{}', { status: 200 }), async () => {
    assert.equal(await sendDueReminders(env, { milestone: '24h' }), 0);
    assert.equal(await sendDueReminders(env, { milestone: '1h' }), 0);
  });
});

test('reminders: a booking a day out gets the 24h nudge but not the 1h one yet', async () => {
  const { env } = await confirmedBookingDueIn(20 * HOUR);

  await withStubbedFetch(() => new Response('{"id":"ok"}', { status: 200 }), async () => {
    assert.equal(await sendDueReminders(env, { milestone: '1h' }), 0, 'still 20h away');
    assert.equal(await sendDueReminders(env, { milestone: '24h' }), 1);
  });
});
