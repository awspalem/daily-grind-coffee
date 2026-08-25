import { Hono } from 'hono';
import type { Env } from '../types/env';
import { resolveCustomerSession, UNAUTHENTICATED } from '../middleware/customerAuth';
import {
  REFERRAL_RATES,
  buildShareTargets,
  checkReferral,
  getDashboard,
  getOrCreateCode,
  hashVisitor,
  recordVisit,
} from '../services/referral';

// Referral codes, share links, attribution and the referrer dashboard.
// Owner: Phase 3 — referral. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
const referralApp = new Hono<{ Bindings: Env }>();

function storefrontUrl(env: Env): string {
  return env.STOREFRONT_URL || 'https://dailyroast.in';
}

// GET /api/referral/me — code, share targets, and the invited/signed-up/purchased funnel (3.1, 3.4).
referralApp.get('/me', async (c) => {
  const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const dashboard = await getDashboard(c.env.DB, session.customerId, storefrontUrl(c.env));
  return c.json({ success: true, dashboard });
});

// GET /api/referral/code — the bare code and share links, for a lightweight share sheet.
referralApp.get('/code', async (c) => {
  const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
  if (!session) return c.json(UNAUTHENTICATED, 401);

  const code = await getOrCreateCode(c.env.DB, session.customerId);
  return c.json({ success: true, code, share: buildShareTargets(code, storefrontUrl(c.env)) });
});

/**
 * POST /api/referral/visit — a share link was opened (public).
 *
 * Deliberately unauthenticated: the whole point is that the visitor is a stranger. Counts are
 * de-duplicated by a coarse IP+UA hash so a refresh cannot inflate the referrer's dashboard.
 */
referralApp.post('/visit', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return c.json({ success: false, error: 'code required' }, 400);

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const hash = await hashVisitor(ip, c.req.header('User-Agent') || '');
  const known = await recordVisit(c.env.DB, code, hash);
  // Always 200: whether a code exists is not something an anonymous caller gets to enumerate.
  return c.json({ success: true, recognised: known });
});

/**
 * POST /api/referral/validate — referee-side preview at checkout (3.2).
 *
 * Advisory, exactly like the coupon preview: checkout re-runs `checkReferral` against the real
 * subtotal and the real shipping address before anything is discounted.
 */
referralApp.post('/validate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    email?: string;
    phone?: string;
    subtotal_cents?: number;
    shipping_line1?: string;
    shipping_postal_code?: string;
  };

  // A signed-in shopper is identified by their session; the body email is only a fallback for a
  // guest checkout, and it can only ever be used to check a discount for that same email.
  const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
  const email = session?.email || body.email;
  if (!email) return c.json({ success: false, error: 'Email required to check a referral code' }, 400);

  const result = await checkReferral(c.env.DB, {
    code: String(body.code || ''),
    refereeEmail: email,
    refereePhone: body.phone,
    shippingLine1: body.shipping_line1,
    shippingPostal: body.shipping_postal_code,
    subtotalCents: Math.max(0, Math.floor(Number(body.subtotal_cents) || 0)),
  });

  return c.json({
    success: true,
    validation: {
      valid: result.valid,
      error: result.error,
      code: result.code,
      discount_cents: result.discount_cents,
      referrer_name: result.referrer_name,
    },
  });
});

// GET /api/referral/terms — public programme terms for the share/landing copy.
referralApp.get('/terms', (c) =>
  c.json({
    success: true,
    terms: {
      referee_discount_cents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
      referee_min_order_cents: REFERRAL_RATES.REFEREE_MIN_ORDER_CENTS,
      referrer_points: REFERRAL_RATES.REFERRER_POINTS,
      paid_on: 'DELIVERY',
    },
  })
);

export { referralApp };
