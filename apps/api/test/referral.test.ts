/**
 * Referral programme (register 3.1–3.4) against real SQLite.
 *
 * Every guard here stands between the shop and free money — a self-referral is a ₹150 discount
 * plus 300 points paid to the same person. The rules are enforced in SQL (a partial UNIQUE index
 * on the referee, normalised email/phone/address comparisons), so they can only be tested against
 * a real database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1, seedCustomer } from './helpers/d1';
import {
  REFERRAL_RATES,
  buildShareTargets,
  checkReferral,
  getDashboard,
  getOrCreateCode,
  hashVisitor,
  qualifyReferral,
  recordVisit,
  referralAttachStatement,
  reverseReferral,
} from '../src/services/referral';
import { getBalance } from '../src/services/loyalty';

const MIN_ORDER = REFERRAL_RATES.REFEREE_MIN_ORDER_CENTS;

async function setup() {
  const db = new TestD1();
  const referrer = seedCustomer(db, 'cust_referrer', 'anita@example.com');
  db.run("UPDATE customers SET phone = '+91 98450 11111', full_name = 'Anita' WHERE id = ?", referrer.id);
  const code = await getOrCreateCode(db as any, referrer.id);
  return { db, referrer, code };
}

function seedOrder(
  db: TestD1,
  opts: { id: string; email: string; customerId?: string | null; status?: string; address?: object }
) {
  db.run(
    `INSERT INTO orders (id, order_number, customer_id, customer_email, status, subtotal_cents,
                         discount_cents, shipping_cents, tax_cents, total_cents, currency, shipping_address_json)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'inr', ?)`,
    opts.id, `TDG-${opts.id}`, opts.customerId ?? null, opts.email,
    opts.status ?? 'DELIVERED', MIN_ORDER, MIN_ORDER,
    JSON.stringify(opts.address ?? { line1: '12 Church Street', postal_code: '560001' })
  );
}

const stranger = {
  code: '',
  refereeEmail: 'newperson@example.com',
  subtotalCents: MIN_ORDER,
  shippingLine1: '99 Residency Road',
  shippingPostal: '560025',
};

// ---------------------------------------------------------------- codes

test('referral: a customer gets one durable code, and asking again returns the same one', async () => {
  const { db, referrer, code } = await setup();

  assert.ok(code.length >= 4);
  assert.equal(code, code.toUpperCase());
  assert.equal(await getOrCreateCode(db as any, referrer.id), code, 'the code must be stable — it gets printed and shared');
  assert.equal(db.select('SELECT id FROM referral_codes WHERE customer_id = ?', referrer.id).length, 1);
});

test('referral: share targets carry the code in the link', () => {
  const share = buildShareTargets('ANITA7', 'https://dailyroast.in');
  assert.match(share.url, /ANITA7/);
  assert.match(share.whatsapp_url, /^https:\/\/(wa\.me|api\.whatsapp\.com)/);
  assert.ok(share.message.length > 0);
});

test('referral: link opens are counted once per visitor, not once per refresh', async () => {
  const { db, code } = await setup();

  const visitor = await hashVisitor('203.0.113.7', 'Mozilla/5.0');
  assert.equal(await recordVisit(db as any, code, visitor), true);
  await recordVisit(db as any, code, visitor);
  await recordVisit(db as any, code, visitor);

  assert.equal(db.select('SELECT id FROM referral_visits').length, 1, 'a refresh must not inflate the dashboard');
  assert.equal(await recordVisit(db as any, 'NOSUCHCODE', visitor), false);
});

// ---------------------------------------------------------------- guards

test('referral: a valid code discounts a new shopper', async () => {
  const { db, code } = await setup();

  const result = await checkReferral(db as any, { ...stranger, code });
  assert.equal(result.valid, true);
  assert.equal(result.discount_cents, REFERRAL_RATES.REFEREE_DISCOUNT_CENTS);
  assert.equal(result.referrer_name, 'Anita');
});

test('referral: an unknown or inactive code is worth nothing', async () => {
  const { db, code, referrer } = await setup();

  const unknown = await checkReferral(db as any, { ...stranger, code: 'MADEITUP' });
  assert.equal(unknown.valid, false);

  db.run('UPDATE referral_codes SET is_active = 0 WHERE customer_id = ?', referrer.id);
  const deactivated = await checkReferral(db as any, { ...stranger, code });
  assert.equal(deactivated.valid, false);
});

test('referral: guard 1 — you cannot refer yourself by email, whatever the casing', async () => {
  const { db, code } = await setup();

  const result = await checkReferral(db as any, { ...stranger, code, refereeEmail: '  ANITA@Example.com ' });
  assert.equal(result.valid, false);
  assert.equal(result.blockedReason, 'SELF_EMAIL');
});

test('referral: guard 2 — a second email on the same phone number is blocked', async () => {
  const { db, code } = await setup();

  // Same handset, formatted differently.
  const result = await checkReferral(db as any, {
    ...stranger, code, refereeEmail: 'anita.second@example.com', refereePhone: '09845011111',
  });
  assert.equal(result.valid, false);
  assert.equal(result.blockedReason, 'SELF_PHONE');
});

test('referral: guard 3 — one reward per referee, ever', async () => {
  const { db, code, referrer } = await setup();

  seedOrder(db, { id: 'ord_first', email: stranger.refereeEmail, status: 'PAID' });
  await db.batch([
    referralAttachStatement(db as any, {
      referrerCustomerId: referrer.id, code, refereeEmail: stranger.refereeEmail,
      orderId: 'ord_first', discountCents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
    }),
  ]);

  const second = await checkReferral(db as any, { ...stranger, code });
  assert.equal(second.valid, false);
  assert.equal(second.blockedReason, 'ALREADY_REFERRED');
});

test('referral: guard 4 — an existing customer cannot be referred', async () => {
  const { db, code } = await setup();
  seedOrder(db, { id: 'ord_prior', email: stranger.refereeEmail, status: 'DELIVERED' });

  const result = await checkReferral(db as any, { ...stranger, code });
  assert.equal(result.valid, false);
  assert.equal(result.blockedReason, 'EXISTING_CUSTOMER');
});

test('referral: guard 4 — an abandoned checkout does not make someone an existing customer', async () => {
  const { db, code } = await setup();
  seedOrder(db, { id: 'ord_abandoned', email: stranger.refereeEmail, status: 'PENDING_PAYMENT' });

  const result = await checkReferral(db as any, { ...stranger, code });
  assert.equal(result.valid, true, 'never paying for anything must not cost someone the discount');
});

test('referral: guard 5 — a second email shipping to the referrer’s flat is blocked', async () => {
  const { db, code, referrer } = await setup();
  seedOrder(db, {
    id: 'ord_ref_own', email: referrer.email, customerId: referrer.id, status: 'DELIVERED',
    address: { line1: '4B Brigade Gardens, Ashok Nagar', postal_code: '560025' },
  });

  const result = await checkReferral(db as any, {
    ...stranger, code,
    shippingLine1: '4b brigade gardens,  ashok nagar ',
    shippingPostal: '560 025',
  });
  assert.equal(result.valid, false);
  assert.equal(result.blockedReason, 'SELF_ADDRESS');
});

test('referral: guard 5 — a different address at the same postcode is fine', async () => {
  const { db, code, referrer } = await setup();
  seedOrder(db, {
    id: 'ord_ref_own2', email: referrer.email, customerId: referrer.id, status: 'DELIVERED',
    address: { line1: '4B Brigade Gardens', postal_code: '560025' },
  });

  const result = await checkReferral(db as any, {
    ...stranger, code, shippingLine1: '77 Langford Road', shippingPostal: '560025',
  });
  assert.equal(result.valid, true, 'neighbours are not fraudsters');
});

test('referral: guard 6 — a code farming referrals is throttled', async () => {
  const { db, code, referrer } = await setup();

  for (let i = 0; i < REFERRAL_RATES.MAX_REFERRALS_PER_30_DAYS; i++) {
    seedOrder(db, { id: `ord_f${i}`, email: `friend${i}@example.com`, status: 'PAID' });
    await db.batch([
      referralAttachStatement(db as any, {
        referrerCustomerId: referrer.id, code, refereeEmail: `friend${i}@example.com`,
        orderId: `ord_f${i}`, discountCents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
      }),
    ]);
  }

  const throttled = await checkReferral(db as any, { ...stranger, code });
  assert.equal(throttled.valid, false);
  assert.match(throttled.error!, /limit/i);
});

test('referral: a basket under the minimum earns no discount', async () => {
  const { db, code } = await setup();

  const result = await checkReferral(db as any, { ...stranger, code, subtotalCents: MIN_ORDER - 1 });
  assert.equal(result.valid, false);
  assert.match(result.error!, /over ₹/);
});

test('referral: the discount never exceeds the basket', async () => {
  const { db, code } = await setup();
  const tiny = REFERRAL_RATES.REFEREE_DISCOUNT_CENTS - 100;

  const result = await checkReferral(db as any, {
    ...stranger, code, subtotalCents: Math.max(MIN_ORDER, tiny),
  });
  assert.equal(result.valid, true);
  assert.ok(result.discount_cents <= Math.max(MIN_ORDER, tiny));
});

// ---------------------------------------------------------------- attribution & payout

test('referral: two concurrent orders cannot both claim the same referee', async () => {
  const { db, code, referrer } = await setup();
  seedOrder(db, { id: 'ord_a', email: stranger.refereeEmail, status: 'PAID' });
  seedOrder(db, { id: 'ord_b', email: stranger.refereeEmail, status: 'PAID' });

  const attach = (orderId: string) =>
    referralAttachStatement(db as any, {
      referrerCustomerId: referrer.id, code, refereeEmail: stranger.refereeEmail,
      orderId, discountCents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
    });

  await db.batch([attach('ord_a')]);
  // The partial UNIQUE index must fail the second batch outright: a discounted order with no
  // referral behind it is exactly the hole this closes.
  await assert.rejects(() => db.batch([attach('ord_b')]));
  assert.equal(db.select('SELECT id FROM referrals').length, 1);
});

test('referral: the referrer is paid on delivery, once, and reversed on refund', async () => {
  const { db, code, referrer } = await setup();
  seedOrder(db, { id: 'ord_paid', email: stranger.refereeEmail, status: 'PAID' });
  await db.batch([
    referralAttachStatement(db as any, {
      referrerCustomerId: referrer.id, code, refereeEmail: stranger.refereeEmail,
      orderId: 'ord_paid', discountCents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
    }),
  ]);

  const before = await getBalance(db as any, referrer.id);
  const paid = await qualifyReferral(db as any, 'ord_paid');
  assert.equal(paid, REFERRAL_RATES.REFERRER_POINTS);
  assert.equal(await getBalance(db as any, referrer.id), before + REFERRAL_RATES.REFERRER_POINTS);

  // A replayed courier webhook must not pay a second time.
  assert.equal(await qualifyReferral(db as any, 'ord_paid'), 0);
  assert.equal(await getBalance(db as any, referrer.id), before + REFERRAL_RATES.REFERRER_POINTS);

  await reverseReferral(db as any, 'ord_paid');
  assert.equal(await getBalance(db as any, referrer.id), before, 'a refunded order must not leave the reward standing');
  assert.equal(
    db.get<{ status: string }>("SELECT status FROM referrals WHERE order_id = 'ord_paid'")!.status,
    'REVERSED'
  );
});

test('referral: nothing is paid for an order that carries no referral', async () => {
  const { db } = await setup();
  seedOrder(db, { id: 'ord_plain', email: 'someone@example.com', status: 'DELIVERED' });
  assert.equal(await qualifyReferral(db as any, 'ord_plain'), 0);
});

test('referral: the dashboard separates paid points from pending ones', async () => {
  const { db, code, referrer } = await setup();

  seedOrder(db, { id: 'ord_p1', email: 'one@example.com', status: 'PAID' });
  seedOrder(db, { id: 'ord_p2', email: 'two@example.com', status: 'PAID' });
  for (const [orderId, email] of [['ord_p1', 'one@example.com'], ['ord_p2', 'two@example.com']]) {
    await db.batch([
      referralAttachStatement(db as any, {
        referrerCustomerId: referrer.id, code, refereeEmail: email,
        orderId, discountCents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
      }),
    ]);
  }
  await qualifyReferral(db as any, 'ord_p1');

  const dashboard = await getDashboard(db as any, referrer.id, 'https://dailyroast.in');
  assert.equal(dashboard.code, code);
  assert.equal(dashboard.stats.purchased, 2);
  assert.equal(dashboard.stats.points_earned, REFERRAL_RATES.REFERRER_POINTS);
  assert.equal(dashboard.stats.points_pending, REFERRAL_RATES.REFERRER_POINTS);

  // The referrer sees that someone ordered without being handed their friend's address book.
  for (const row of dashboard.recent) {
    assert.ok(!row.referee_masked.includes('one@example.com'));
    assert.ok(!row.referee_masked.includes('two@example.com'));
    assert.match(row.referee_masked, /•/, 'the local part must be masked');
  }
});
