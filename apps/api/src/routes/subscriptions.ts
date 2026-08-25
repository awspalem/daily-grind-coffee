import { Hono } from 'hono';
import type { Env } from '../types/env';
import { resolveCustomerSession, UNAUTHENTICATED } from '../middleware/customerAuth';
import { zeroTrustAdminGuard, recordAuditLog, type AdminActor } from '../middleware/zeroTrust';
import { StripeService } from '../services/stripe';
import { InventoryLedgerService } from '../services/inventoryLedger';
import {
  FREQUENCY_DAYS,
  acceptSaveOffer,
  addDays,
  addMonths,
  buildSaveOffer,
  cancelSubscription,
  findOwnedSubscription,
  getPlan,
  getPlanPerkBalances,
  listOwnedSubscriptions,
  listPlans,
  newId,
  pauseSubscription,
  projectUpcomingShipments,
  recordSubscriptionEvent,
  restorePaymentMethod,
  resumeSubscription,
  serialisePlan,
  serialiseSubscription,
  skipNextDelivery,
  swapCoffee,
  updateSubscription,
} from '../services/subscriptionPlans';

// Customer-facing subscription management, plan tiers and entitlement grants.
// Owner: Phase 4 — subscription tiers. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const subscriptionsApp = new Hono<{ Bindings: Env; Variables: { adminActor: AdminActor } }>();

/** Resolves the caller, or writes the 401. Every customer route starts here. */
async function requireCustomer(c: any) {
  const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
  if (!session) return { session: null, res: c.json(UNAUTHENTICATED, 401) };
  return { session, res: null };
}

/**
 * Loads a subscription the caller actually owns. Authentication alone is not enough — without
 * the ownership check any signed-in customer could pause or cancel a stranger's subscription by
 * guessing an id.
 */
async function requireOwnedSubscription(c: any, session: { customerId: string; email: string }) {
  const sub = await findOwnedSubscription(c.env.DB, c.req.param('id'), session);
  if (!sub) return { sub: null, res: c.json({ success: false, error: 'Subscription not found' }, 404) };
  return { sub, res: null };
}

async function readJson(c: any): Promise<any> {
  try {
    return (await c.req.json()) || {};
  } catch {
    return {};
  }
}

/**
 * Creates a PENDING_PAYMENT order for one coffee delivery and reserves the stock, exactly as
 * routes/checkout.ts does for a normal basket. The webhook converts the reservation to
 * ORDER_FULFILLED when Stripe confirms, so skipping the reserve here would leave the ledger
 * short by whatever the plan ships.
 */
async function createDeliveryOrder(
  env: Env,
  params: {
    orderId: string;
    orderNumber: string;
    customerId: string;
    customerEmail: string;
    variantId: string;
    productName: string;
    grindType: string;
    quantity: number;
    unitPriceCents: number;
    frequency: string;
    shippingAddressJson: string;
    notes: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ledger = new InventoryLedgerService(env.DB);
  const lineTotal = params.unitPriceCents * params.quantity;

  try {
    await ledger.recordMovement({
      variantId: params.variantId,
      movementType: 'PURCHASE_RESERVE',
      delta: -params.quantity,
      referenceType: 'ORDER',
      referenceId: params.orderId,
      reason: `Subscription plan delivery — ${params.productName}`,
      actor: 'PLAN_CHECKOUT',
    });
  } catch (err: any) {
    return { ok: false, error: err?.message || 'That coffee is out of stock' };
  }

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_email, status, subtotal_cents, shipping_cents,
        tax_cents, discount_cents, total_cents, currency, shipping_address_json, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING_PAYMENT', ?, 0, 0, 0, ?, 'inr', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      params.orderId, params.orderNumber, params.customerId, params.customerEmail,
      lineTotal, lineTotal, params.shippingAddressJson, params.notes
    ),
    env.DB.prepare(`
      INSERT INTO order_items (
        id, order_id, variant_id, product_name, weight_grams, grind_type,
        unit_price_cents, quantity, total_price_cents, subscription_frequency
      ) VALUES (?, ?, ?, ?, (SELECT weight_grams FROM product_variants WHERE id = ?), ?, ?, ?, ?, ?)
    `).bind(
      newId('oi'), params.orderId, params.variantId, params.productName, params.variantId,
      params.grindType, params.unitPriceCents, params.quantity, lineTotal, params.frequency
    ),
  ]);

  return { ok: true };
}

// ==================== Public catalog ====================

// GET /api/subscriptions/plans — the tier grid on the storefront.
subscriptionsApp.get('/plans', async (c) => {
  const plans = await listPlans(c.env.DB);
  return c.json({ success: true, plans: plans.map(serialisePlan) });
});

subscriptionsApp.get('/plans/:slug', async (c) => {
  const plan = await getPlan(c.env.DB, c.req.param('slug'));
  if (!plan || !plan.is_active) return c.json({ success: false, error: 'Plan not found' }, 404);
  return c.json({ success: true, plan: serialisePlan(plan) });
});

// ==================== Plan purchase ====================

/**
 * POST /api/subscriptions/checkout — buys a plan.
 *
 * Mints its own order + subscription rows and its own Stripe session rather than going through
 * routes/checkout.ts (owned by the loyalty/referral work). Because the order carries
 * `metadata[order_id]`, the existing webhook still matches it, which is what gives this flow the
 * onOrderPaid dispatch (entitlement grants) and the saved-payment-method capture for free.
 */
subscriptionsApp.post('/checkout', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;

  const body = await readJson(c);
  const plan = body.plan_slug ? await getPlan(c.env.DB, String(body.plan_slug)) : null;
  if (!plan || !plan.is_active) return c.json({ success: false, error: 'Plan not found' }, 404);

  const variant = await c.env.DB.prepare(`
    SELECT v.id, v.price_cents, v.weight_grams, p.name AS product_name
    FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1
  `).bind(String(body.variant_id || '')).first<{ id: string; price_cents: number; weight_grams: number; product_name: string }>();
  if (!variant) return c.json({ success: false, error: 'Choose a coffee to start with' }, 400);

  const frequency = String(body.frequency || plan.default_frequency);
  if (!FREQUENCY_DAYS[frequency]) return c.json({ success: false, error: 'Unknown delivery frequency' }, 400);

  const quantity = Math.max(1, Math.min(10, Math.trunc(Number(body.quantity) || 1)));
  const grind = String(body.grind_type || 'WHOLE_BEAN');
  const shippingAddress = body.shipping_address && typeof body.shipping_address === 'object'
    ? body.shipping_address
    : null;

  // Annual is prepaid: one charge covers the whole term. Monthly charges the first delivery now
  // and lets the renewal cron take it from there at the tier's discount.
  const isAnnual = plan.term === 'ANNUAL';
  const perDeliveryCents = Math.round(variant.price_cents * (1 - plan.discount_percent / 100)) * quantity;
  const chargeCents = isAnnual ? plan.price_cents : perDeliveryCents;

  const orderId = newId('ord');
  const orderNumber = 'TDR-' + Math.floor(100000 + Math.random() * 900000);
  const subscriptionId = newId('sub');
  const now = new Date().toISOString();
  const addressJson = shippingAddress ? JSON.stringify(shippingAddress) : '{}';

  if (isAnnual) {
    // The annual charge buys the term, not a bag. Its deliveries become their own orders as the
    // year runs, so this order carries no line item and reserves no stock.
    await c.env.DB.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_email, status, subtotal_cents, shipping_cents,
        tax_cents, discount_cents, total_cents, currency, shipping_address_json, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING_PAYMENT', ?, 0, 0, 0, ?, 'inr', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      orderId, orderNumber, session.customerId, session.email, chargeCents, chargeCents,
      addressJson, `${plan.name} (annual, prepaid) subscription purchase`
    ).run();
  } else {
    const created = await createDeliveryOrder(c.env, {
      orderId,
      orderNumber,
      customerId: session.customerId,
      customerEmail: session.email,
      variantId: variant.id,
      productName: variant.product_name,
      grindType: grind,
      quantity,
      unitPriceCents: Math.round(variant.price_cents * (1 - plan.discount_percent / 100)),
      frequency,
      shippingAddressJson: addressJson,
      notes: `${plan.name} (monthly) — first delivery`,
    });
    if (!created.ok) return c.json({ success: false, error: created.error }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO subscriptions (
        id, customer_email, customer_id, order_id, variant_id, product_name, grind_type,
        frequency, quantity, unit_price_cents, discount_percent, status, next_renewal_date,
        shipping_address_json, plan_id, plan_term, term_started_at, term_ends_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?)
    `).bind(
      subscriptionId, session.email, session.customerId, orderId, variant.id, variant.product_name,
      grind, frequency, quantity, variant.price_cents,
      // The cron prices renewals off this column, so the tier's discount has to live here —
      // that is how tiered pricing reaches a billing loop this feature cannot edit.
      plan.discount_percent,
      // Provisional until payment lands; the order-paid hook is what starts the real clock.
      addDays(now, FREQUENCY_DAYS[frequency]),
      addressJson,
      plan.id, plan.term, now, addMonths(now, plan.term_months || 1)
    ),
  ]);

  await recordSubscriptionEvent(c.env.DB, subscriptionId, 'CREATED', 'CUSTOMER', {
    plan: plan.slug, term: plan.term, order_id: orderId, charge_cents: chargeCents,
  });

  const storefront = c.env.STOREFRONT_URL || 'https://dailyroast.in';
  const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);

  try {
    const stripeSession = await stripe.createCheckoutSession({
      orderId,
      orderNumber,
      customerEmail: session.email,
      currency: 'inr',
      items: [{
        name: `${plan.name} — ${isAnnual ? 'annual, prepaid' : 'monthly'}`,
        description: isAnnual
          ? `${plan.shipments_included} deliveries of ${variant.product_name}, plus plan perks`
          : `First delivery of ${variant.product_name} at ${plan.discount_percent}% off`,
        unitPriceCents: chargeCents,
        quantity: 1,
      }],
      shippingCents: 0,
      successUrl: `${storefront}/?plan_purchased=${encodeURIComponent(plan.slug)}`,
      cancelUrl: `${storefront}/#subscription-plans`,
      // Even a prepaid annual term saves the card: the term eventually ends, and a PAST_DUE
      // monthly plan needs something to retry against.
      saveForSubscription: true,
    });

    return c.json({
      success: true,
      checkout_url: stripeSession.url,
      order_id: orderId,
      subscription_id: subscriptionId,
      charge_cents: chargeCents,
    });
  } catch (err: any) {
    await c.env.DB.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").bind(orderId).run();
    await c.env.DB.prepare("UPDATE subscriptions SET status = 'CANCELLED' WHERE id = ?").bind(subscriptionId).run();
    console.error('[PLANS] checkout session failed:', err);
    return c.json({ success: false, error: 'Could not start checkout. Please try again.' }, 502);
  }
});

// ==================== The caller's own subscriptions ====================

subscriptionsApp.get('/mine', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;

  const subs = await listOwnedSubscriptions(c.env.DB, session);
  const serialised = [];
  for (const sub of subs) {
    serialised.push({
      ...(await serialiseSubscription(c.env.DB, sub)),
      upcoming: projectUpcomingShipments(sub, 3),
    });
  }
  return c.json({ success: true, subscriptions: serialised });
});

/** GET /api/subscriptions/perks — plan entitlements the caller can still spend. */
subscriptionsApp.get('/perks', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  return c.json({ success: true, perks: await getPlanPerkBalances(c.env.DB, session.customerId) });
});

/** GET /api/subscriptions/upcoming — every future delivery across the caller's subscriptions. */
subscriptionsApp.get('/upcoming', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;

  const subs = await listOwnedSubscriptions(c.env.DB, session);
  const shipments = subs
    .filter((s) => s.status !== 'CANCELLED')
    .flatMap((s) => projectUpcomingShipments(s, 3))
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  return c.json({ success: true, shipments });
});

// Registered after /mine, /perks, /upcoming and /plans — Hono matches in declaration order, so
// a bare `/:id` above them would swallow those paths.
subscriptionsApp.get('/:id', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  const { results: events } = await c.env.DB.prepare(`
    SELECT id, event_type, actor, detail_json, created_at
    FROM subscription_events WHERE subscription_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).bind(sub.id).all();

  return c.json({
    success: true,
    subscription: await serialiseSubscription(c.env.DB, sub),
    upcoming: projectUpcomingShipments(sub, 6),
    events: events || [],
  });
});

// ==================== Self-serve management ====================

subscriptionsApp.post('/:id/pause', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status === 'CANCELLED') return c.json({ success: false, error: 'This subscription is cancelled' }, 400);
  if (sub.status === 'PAUSED') return c.json({ success: true, message: 'Already paused' });

  await pauseSubscription(c.env.DB, sub);
  return c.json({ success: true, message: 'Paused. Nothing will be charged or shipped until you resume.' });
});

subscriptionsApp.post('/:id/resume', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status !== 'PAUSED') return c.json({ success: false, error: 'This subscription is not paused' }, 400);

  const next = await resumeSubscription(c.env.DB, sub);
  return c.json({ success: true, next_renewal_date: next, message: 'Resumed.' });
});

subscriptionsApp.post('/:id/skip', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status === 'CANCELLED') return c.json({ success: false, error: 'This subscription is cancelled' }, 400);

  const next = await skipNextDelivery(c.env.DB, sub);
  return c.json({ success: true, next_renewal_date: next, message: 'Skipped one delivery.' });
});

subscriptionsApp.patch('/:id', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status === 'CANCELLED') return c.json({ success: false, error: 'This subscription is cancelled' }, 400);

  const body = await readJson(c);
  const result = await updateSubscription(c.env.DB, sub, {
    grind_type: body.grind_type,
    frequency: body.frequency,
    quantity: body.quantity,
    shipping_address: body.shipping_address,
    next_renewal_date: body.next_renewal_date,
  });
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);

  const fresh = await findOwnedSubscription(c.env.DB, sub.id, session);
  return c.json({
    success: true,
    subscription: fresh ? await serialiseSubscription(c.env.DB, fresh) : null,
  });
});

subscriptionsApp.post('/:id/swap', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status === 'CANCELLED') return c.json({ success: false, error: 'This subscription is cancelled' }, 400);

  const body = await readJson(c);
  const result = await swapCoffee(c.env.DB, sub, String(body.variant_id || ''));
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true, message: `Switched to ${result.product_name}.` });
});

// ==================== Cancellation & the save offer ====================

/** What we'd rather do than lose them. Read-only — accepting is a separate POST. */
subscriptionsApp.post('/:id/cancel-offer', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  const body = await readJson(c);
  return c.json({ success: true, offer: buildSaveOffer(sub, String(body.reason || '')) });
});

subscriptionsApp.post('/:id/save-offer', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  const body = await readJson(c);
  const kind = String(body.kind || '');
  if (!['PAUSE', 'DISCOUNT', 'SLOWER_CADENCE'].includes(kind)) {
    return c.json({ success: false, error: 'Unknown offer' }, 400);
  }

  const result = await acceptSaveOffer(c.env.DB, sub, kind as 'PAUSE' | 'DISCOUNT' | 'SLOWER_CADENCE');
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true, message: result.message });
});

subscriptionsApp.post('/:id/cancel', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  if (sub.status === 'CANCELLED') return c.json({ success: true, message: 'Already cancelled' });

  const body = await readJson(c);
  await cancelSubscription(c.env.DB, sub, String(body.reason || 'Not given'));
  return c.json({
    success: true,
    message: sub.plan_term === 'ANNUAL'
      ? 'Cancelled. Your plan perks stay valid until the end of the term you paid for.'
      : 'Cancelled. Nothing further will be charged.',
  });
});

// ==================== Dunning: fixing the payment method ====================

/**
 * Starts a Stripe session whose only job is to capture a reusable card. Deliberately a real
 * (small) charge rather than a SetupIntent, because that is the shape `services/stripe.ts`
 * exposes — the amount is the next delivery, so the customer gets something for it.
 */
subscriptionsApp.post('/:id/payment-method/session', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  const storefront = c.env.STOREFRONT_URL || 'https://dailyroast.in';
  const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);
  const unitPrice = Math.round(sub.unit_price_cents * (1 - sub.discount_percent / 100));

  // A real catch-up delivery, not a bare card-capture: the missed cycle is what put the
  // subscription into PAST_DUE, so paying for it is what the customer actually wants to do.
  const orderId = newId('ord');
  const created = await createDeliveryOrder(c.env, {
    orderId,
    orderNumber: 'TDR-' + Math.floor(100000 + Math.random() * 900000),
    customerId: session.customerId,
    customerEmail: session.email,
    variantId: sub.variant_id,
    productName: sub.product_name,
    grindType: sub.grind_type,
    quantity: sub.quantity,
    unitPriceCents: unitPrice,
    frequency: sub.frequency,
    shippingAddressJson: sub.shipping_address_json || '{}',
    notes: `Catch-up delivery and payment-method update for ${sub.id}`,
  });
  if (!created.ok) return c.json({ success: false, error: created.error }, 409);

  try {
    const stripeSession = await stripe.createCheckoutSession({
      orderId,
      orderNumber: orderId,
      customerEmail: session.email,
      currency: 'inr',
      items: [{
        name: `${sub.product_name} — subscription delivery`,
        description: 'Catch-up delivery and updated payment method',
        unitPriceCents: unitPrice,
        quantity: sub.quantity,
      }],
      shippingCents: 0,
      successUrl: `${storefront}/?subscription_payment_fixed=${encodeURIComponent(sub.id)}`,
      cancelUrl: `${storefront}/#subscription-manager`,
      saveForSubscription: true,
    });
    return c.json({ success: true, checkout_url: stripeSession.url, session_id: stripeSession.id });
  } catch (err) {
    await c.env.DB.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").bind(orderId).run();
    console.error('[PLANS] payment-method session failed:', err);
    return c.json({ success: false, error: 'Could not open the payment page. Please try again.' }, 502);
  }
});

/**
 * Confirms the session above and re-arms the subscription.
 *
 * PAST_DUE is otherwise a dead end: the renewal cron only ever selects `status = 'ACTIVE'`, so
 * a subscription it marked PAST_DUE is never retried by anything. This is the only path back.
 */
subscriptionsApp.post('/:id/payment-method/confirm', async (c) => {
  const { session, res } = await requireCustomer(c);
  if (!session) return res;
  const { sub, res: notFound } = await requireOwnedSubscription(c, session);
  if (!sub) return notFound;

  const body = await readJson(c);
  const sessionId = String(body.session_id || '');
  if (!sessionId) return c.json({ success: false, error: 'Missing session_id' }, 400);

  const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);
  const billing = await stripe.getSessionBillingDetails(sessionId);
  const result = await restorePaymentMethod(c.env.DB, sub, billing);
  if (!result.ok) return c.json({ success: false, error: result.error }, 400);

  return c.json({ success: true, message: 'Payment method updated. Your subscription is active again.' });
});

// ==================== Staff ====================
//
// Mounted under /api/subscriptions/admin/* rather than in routes/admin.ts, which belongs to
// another workstream. Same Cloudflare Zero Trust guard that protects every other admin route.

const adminPlans = new Hono<{ Bindings: Env; Variables: { adminActor: AdminActor } }>();
adminPlans.use('*', zeroTrustAdminGuard);

const TIERS = ['EXPLORER', 'CONNOISSEUR', 'FOUNDER'];
const TERMS = ['MONTHLY', 'ANNUAL'];

adminPlans.get('/plans', async (c) => {
  const plans = await listPlans(c.env.DB, true);
  const { results: counts } = await c.env.DB.prepare(`
    SELECT plan_id, status, COUNT(*) AS count
    FROM subscriptions WHERE plan_id IS NOT NULL GROUP BY plan_id, status
  `).all<{ plan_id: string; status: string; count: number }>();

  const byPlan = new Map<string, Record<string, number>>();
  for (const row of counts || []) {
    const entry = byPlan.get(row.plan_id) || {};
    entry[row.status] = row.count;
    byPlan.set(row.plan_id, entry);
  }

  return c.json({
    success: true,
    plans: plans.map((p) => ({ ...serialisePlan(p), subscriber_counts: byPlan.get(p.id) || {} })),
  });
});

/** Validates and normalises the writable fields shared by create and update. */
function readPlanInput(body: any): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return { ok: false, error: 'Name is required' };
    value.name = name;
  }
  if (body.tier !== undefined) {
    if (!TIERS.includes(String(body.tier))) return { ok: false, error: 'Unknown tier' };
    value.tier = String(body.tier);
  }
  if (body.term !== undefined) {
    if (!TERMS.includes(String(body.term))) return { ok: false, error: 'Term must be MONTHLY or ANNUAL' };
    value.term = String(body.term);
  }
  if (body.price_cents !== undefined) {
    const price = Math.trunc(Number(body.price_cents));
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: 'Price must be a positive amount in paise' };
    value.price_cents = price;
  }
  if (body.discount_percent !== undefined) {
    const pct = Math.trunc(Number(body.discount_percent));
    // Capped well below 100: the renewal cron multiplies the variant price by (1 - pct/100), so
    // a fat-fingered 150 would produce negative charges.
    if (!Number.isFinite(pct) || pct < 0 || pct > 60) return { ok: false, error: 'Discount must be between 0 and 60%' };
    value.discount_percent = pct;
  }
  if (body.default_frequency !== undefined) {
    if (!FREQUENCY_DAYS[String(body.default_frequency)]) return { ok: false, error: 'Unknown delivery frequency' };
    value.default_frequency = String(body.default_frequency);
  }
  if (body.term_months !== undefined) {
    const months = Math.trunc(Number(body.term_months));
    if (!Number.isFinite(months) || months < 1 || months > 36) return { ok: false, error: 'Term must be 1–36 months' };
    value.term_months = months;
  }
  if (body.shipments_included !== undefined) {
    value.shipments_included = body.shipments_included === null ? null : Math.max(1, Math.trunc(Number(body.shipments_included) || 1));
  }
  if (body.perks !== undefined) {
    if (!Array.isArray(body.perks)) return { ok: false, error: 'Perks must be a list' };
    value.perks_json = JSON.stringify(body.perks.map((p: unknown) => String(p)));
  }
  if (body.entitlements !== undefined) {
    if (!Array.isArray(body.entitlements)) return { ok: false, error: 'Entitlements must be a list' };
    for (const e of body.entitlements) {
      if (!e || typeof e.code !== 'string' || typeof e.units !== 'number') {
        return { ok: false, error: 'Each entitlement needs a code and a unit count' };
      }
    }
    value.entitlements_json = JSON.stringify(body.entitlements.map((e: any) => ({
      code: String(e.code), units: Math.trunc(Number(e.units)),
    })));
  }
  if (body.tagline !== undefined) value.tagline = body.tagline === null ? null : String(body.tagline);
  if (body.description !== undefined) value.description = body.description === null ? null : String(body.description);
  if (body.badge !== undefined) value.badge = body.badge === null ? null : String(body.badge);
  if (body.display_order !== undefined) value.display_order = Math.trunc(Number(body.display_order) || 0);
  if (body.is_active !== undefined) value.is_active = body.is_active ? 1 : 0;

  return { ok: true, value };
}

adminPlans.post('/plans', async (c) => {
  const actor = c.get('adminActor');
  const body = await readJson(c);
  const parsed = readPlanInput(body);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);

  const slug = String(body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!slug) return c.json({ success: false, error: 'Slug is required' }, 400);
  if (!parsed.value.name || !parsed.value.tier || !parsed.value.term || parsed.value.price_cents === undefined) {
    return c.json({ success: false, error: 'Name, tier, term and price are all required' }, 400);
  }

  const existing = await getPlan(c.env.DB, slug);
  if (existing) return c.json({ success: false, error: 'A plan with that slug already exists' }, 409);

  const id = newId('plan');
  const columns = ['id', 'slug', ...Object.keys(parsed.value)];
  const values = [id, slug, ...Object.values(parsed.value)];
  await c.env.DB.prepare(
    `INSERT INTO subscription_plans (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  await recordAuditLog(c.env.DB, actor, 'PLAN_CREATED', 'SUBSCRIPTION_PLAN', id, null, { slug, ...parsed.value });
  const created = await getPlan(c.env.DB, id);
  return c.json({ success: true, plan: created ? serialisePlan(created) : null }, 201);
});

adminPlans.patch('/plans/:id', async (c) => {
  const actor = c.get('adminActor');
  const plan = await getPlan(c.env.DB, c.req.param('id'));
  if (!plan) return c.json({ success: false, error: 'Plan not found' }, 404);

  const parsed = readPlanInput(await readJson(c));
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  if (!Object.keys(parsed.value).length) return c.json({ success: false, error: 'Nothing to update' }, 400);

  const sets = Object.keys(parsed.value).map((k) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(
    `UPDATE subscription_plans SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...Object.values(parsed.value), plan.id).run();

  await recordAuditLog(c.env.DB, actor, 'PLAN_UPDATED', 'SUBSCRIPTION_PLAN', plan.id, serialisePlan(plan), parsed.value);
  const updated = await getPlan(c.env.DB, plan.id);
  return c.json({ success: true, plan: updated ? serialisePlan(updated) : null });
});

/**
 * Retires a plan. Never a DELETE: live subscriptions reference it, and the perks their members
 * already hold were defined by this row. Retiring only hides it from the storefront.
 */
adminPlans.delete('/plans/:id', async (c) => {
  const actor = c.get('adminActor');
  const plan = await getPlan(c.env.DB, c.req.param('id'));
  if (!plan) return c.json({ success: false, error: 'Plan not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE subscription_plans SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(plan.id).run();
  await recordAuditLog(c.env.DB, actor, 'PLAN_RETIRED', 'SUBSCRIPTION_PLAN', plan.id, { is_active: true }, { is_active: false });
  return c.json({ success: true, message: `${plan.name} retired. Existing members keep their plan.` });
});

/** GET /api/subscriptions/admin/subscribers — who is on what, newest first. */
adminPlans.get('/subscribers', async (c) => {
  const planId = c.req.query('plan_id');
  const status = c.req.query('status');
  const filters: string[] = [];
  const binds: unknown[] = [];
  if (planId) { filters.push('s.plan_id = ?'); binds.push(planId); }
  if (status) { filters.push('s.status = ?'); binds.push(status); }

  const { results } = await c.env.DB.prepare(`
    SELECT s.id, s.customer_email, s.product_name, s.grind_type, s.frequency, s.quantity,
           s.status, s.discount_percent, s.next_renewal_date, s.term_ends_at,
           s.shipments_remaining, s.cancel_reason, s.created_at,
           p.name AS plan_name, p.tier AS plan_tier, p.term AS plan_term,
           (s.stripe_payment_method_id IS NOT NULL) AS has_payment_method
    FROM subscriptions s
    LEFT JOIN subscription_plans p ON p.id = s.plan_id
    ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
    ORDER BY CASE s.status
               WHEN 'PAST_DUE' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'PREPAID' THEN 2
               WHEN 'PAUSED' THEN 3 ELSE 4 END,
             s.next_renewal_date ASC
    LIMIT 300
  `).bind(...binds).all();

  return c.json({ success: true, subscribers: results || [] });
});

/** Outstanding entitlement balances by plan, so staff can see what has been promised. */
adminPlans.get('/entitlements', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT g.entitlement_code,
           COUNT(*) AS grant_count,
           SUM(CASE WHEN g.total_units = -1 THEN 0 ELSE MAX(0, g.total_units - g.used_units) END) AS units_outstanding,
           SUM(g.used_units) AS units_used
    FROM entitlement_grants g
    WHERE g.source_type IN ('SUBSCRIPTION', 'PLAN_RENEWAL') AND g.status = 'ACTIVE'
    GROUP BY g.entitlement_code
    ORDER BY g.entitlement_code
  `).all();
  return c.json({ success: true, entitlements: results || [] });
});

subscriptionsApp.route('/admin', adminPlans);

export { subscriptionsApp };
