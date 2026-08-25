import { Hono } from 'hono';
import { resolveCustomerSession, UNAUTHENTICATED } from '../middleware/customerAuth';
import { LOYALTY_RATES, creditPoints, getStatement, getSummary, previewRedemption, } from '../services/loyalty';
// Loyalty points ledger: earning, redemption, tiers, statement.
// Owner: Phase 2 — loyalty. Routes are mounted in ../index.ts — do not edit that file to add endpoints
// here; add them to this app instead.
//
// Every endpoint below is scoped by the `X-Customer-Session` token. The customer's identity is
// never taken from the request body: an email in a payload would let anyone read — or spend —
// someone else's balance.
const loyaltyApp = new Hono();
/** Public programme terms, so the storefront can explain the scheme before anyone signs in. */
loyaltyApp.get('/config', (c) => c.json({
    success: true,
    config: {
        rupees_per_point_earned: LOYALTY_RATES.RUPEES_PER_POINT_EARNED,
        point_value_cents: LOYALTY_RATES.POINT_VALUE_CENTS,
        min_redeem_points: LOYALTY_RATES.MIN_REDEEM_POINTS,
        max_redeem_percent: LOYALTY_RATES.MAX_REDEEM_PERCENT,
        expiry_months: LOYALTY_RATES.EXPIRY_MONTHS,
        signup_bonus_points: LOYALTY_RATES.SIGNUP_BONUS_POINTS,
        review_bonus_points: LOYALTY_RATES.REVIEW_BONUS_POINTS,
        tier_thresholds_cents: LOYALTY_RATES.TIER_THRESHOLDS_CENTS,
    },
}));
// GET /api/loyalty/summary — balance, tier, progress, expiry warning.
loyaltyApp.get('/summary', async (c) => {
    const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const summary = await getSummary(c.env.DB, session.customerId);
    if (!summary)
        return c.json({ success: false, error: 'Customer not found' }, 404);
    return c.json({ success: true, summary });
});
// GET /api/loyalty/statement — the ledger, human-readable. 2.5.
loyaltyApp.get('/statement', async (c) => {
    const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const limit = Number(c.req.query('limit') || 50);
    const offset = Number(c.req.query('offset') || 0);
    const entries = await getStatement(c.env.DB, session.customerId, limit, offset);
    return c.json({ success: true, entries });
});
// POST /api/loyalty/redeem/preview — advisory only; checkout re-computes authoritatively.
loyaltyApp.post('/redeem/preview', async (c) => {
    const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const body = (await c.req.json().catch(() => ({})));
    const subtotal = Math.max(0, Math.floor(Number(body.subtotal_cents) || 0));
    const preview = await previewRedemption(c.env.DB, session.customerId, subtotal);
    return c.json({ success: true, preview });
});
/**
 * POST /api/loyalty/claim-review — the review bonus (2.2).
 *
 * `reviews` carries no customer id (only a display name and a self-reported order number), and
 * routes/reviews.ts belongs to another feature, so the bonus is claimed rather than pushed. The
 * claim is safe because it verifies the review's order number resolves to an order placed by
 * *this* session's email, and because the bonus is keyed on the order — one bonus per order, not
 * one per review, so six bags cannot become six bonuses.
 */
loyaltyApp.post('/claim-review', async (c) => {
    const session = await resolveCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session)
        return c.json(UNAUTHENTICATED, 401);
    const body = (await c.req.json().catch(() => ({})));
    if (!body.review_id)
        return c.json({ success: false, error: 'review_id required' }, 400);
    const review = await c.env.DB.prepare('SELECT id, order_number FROM reviews WHERE id = ?')
        .bind(body.review_id)
        .first();
    if (!review)
        return c.json({ success: false, error: 'Review not found' }, 404);
    if (!review.order_number) {
        return c.json({ success: false, error: 'Add your order number to the review to earn points' }, 400);
    }
    const order = await c.env.DB.prepare(`SELECT id FROM orders WHERE order_number = ? AND customer_email = ? AND status NOT IN ('PENDING_PAYMENT', 'CANCELLED')`)
        .bind(review.order_number, session.email)
        .first();
    if (!order)
        return c.json({ success: false, error: 'That review is not for one of your orders' }, 403);
    const result = await creditPoints(c.env.DB, {
        customerId: session.customerId,
        points: LOYALTY_RATES.REVIEW_BONUS_POINTS,
        entryType: 'EARN',
        reason: 'REVIEW_BONUS',
        refType: 'REVIEW',
        refId: review.id,
        note: 'Thanks for reviewing your coffee',
        idempotencyKey: `loyalty:review:${order.id}`,
    });
    if (!result.applied) {
        return c.json({ success: true, awarded: 0, message: 'You have already earned points for this order' });
    }
    return c.json({ success: true, awarded: result.points, balance: result.balance });
});
export { loyaltyApp };
