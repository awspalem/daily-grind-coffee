import type { Env } from '../types/env';
import type { FeatureHooks } from './types';
import {
  activatePlanSubscription,
  getPlan,
  grantPlanEntitlements,
  revokePlanEntitlements,
  recordSubscriptionEvent,
  addMonths,
  type SubscriptionRow,
} from '../services/subscriptionPlans';

/**
 * Subscription-plan lifecycle handlers.
 *
 * The plan's perks (consultations, tour and cupping seats, the estate visit, free shipping,
 * early access) become entitlement grants the moment the purchase is paid for, and are revoked
 * if that payment is refunded. Phase 5 bookings spend those grants.
 *
 * Everything here is idempotent: the dispatcher runs on a Stripe webhook, and Stripe retries.
 */

/** Every subscription this order created or renewed that is attached to a plan. */
async function planSubscriptionsForOrder(env: Env, orderId: string): Promise<SubscriptionRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM subscriptions WHERE order_id = ? AND plan_id IS NOT NULL'
  ).bind(orderId).all<SubscriptionRow>();
  return (results || []) as SubscriptionRow[];
}

export const plansHooks: FeatureHooks = {
  async onOrderPaid(env: Env, ctx: { orderId: string; order: any }) {
    const subs = await planSubscriptionsForOrder(env, ctx.orderId);
    if (!subs.length) return;

    for (const sub of subs) {
      const plan = sub.plan_id ? await getPlan(env.DB, sub.plan_id) : null;
      if (!plan) continue;

      // Grants can only hang off a customer record; a guest plan purchase has nothing to hold
      // a balance against, so the perks wait until that email has an account.
      const customerId = sub.customer_id
        || (await env.DB.prepare('SELECT id FROM customers WHERE LOWER(email) = LOWER(?)')
          .bind(sub.customer_email).first<{ id: string }>())?.id;
      if (!customerId) {
        console.warn(`[PLANS] ${sub.id} paid but has no customer record — entitlements deferred`);
        continue;
      }
      if (!sub.customer_id) {
        await env.DB.prepare('UPDATE subscriptions SET customer_id = ? WHERE id = ?')
          .bind(customerId, sub.id).run();
      }

      // The plan's term is the grant window. A fresh purchase stamps it here rather than at
      // session creation, so an abandoned checkout never starts anyone's year running.
      const startsAt = sub.term_started_at || new Date().toISOString();
      const endsAt = sub.term_ends_at || addMonths(startsAt, plan.term_months || 1);

      if (!sub.term_started_at || !sub.term_ends_at) {
        await env.DB.prepare(`
          UPDATE subscriptions
          SET term_started_at = COALESCE(term_started_at, ?),
              term_ends_at = COALESCE(term_ends_at, ?),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(startsAt, endsAt, sub.id).run();
      }

      // A row whose term already carries grants is a renewal of that term, not a first
      // purchase; the source_type distinction is what admin reporting reads.
      const priorGrant = await env.DB.prepare(`
        SELECT id FROM entitlement_grants
        WHERE source_id = ? AND source_type IN ('SUBSCRIPTION', 'PLAN_RENEWAL') LIMIT 1
      `).bind(sub.id).first<{ id: string }>();

      await grantPlanEntitlements(env.DB, {
        customerId,
        subscriptionId: sub.id,
        plan,
        sourceType: priorGrant ? 'PLAN_RENEWAL' : 'SUBSCRIPTION',
        startsAt,
        expiresAt: endsAt,
      });

      // Guarded on `status = 'PENDING_PAYMENT'`, so a webhook replay can't reset the schedule
      // of a subscription the customer has since paused or rescheduled.
      await activatePlanSubscription(env.DB, sub, plan, startsAt);
    }
  },

  async onOrderRefunded(env: Env, ctx: { orderId: string }) {
    const subs = await planSubscriptionsForOrder(env, ctx.orderId);
    for (const sub of subs) {
      const revoked = await revokePlanEntitlements(env.DB, sub.id, `order ${ctx.orderId} refunded`);
      if (revoked > 0) {
        await recordSubscriptionEvent(env.DB, sub.id, 'UPDATED', 'SYSTEM', {
          entitlements_revoked: revoked,
          order_id: ctx.orderId,
        });
      }

      // A refunded plan purchase stops billing too — leaving it ACTIVE would charge the next
      // cycle to a card the customer has just been refunded on.
      await env.DB.prepare(`
        UPDATE subscriptions
        SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP,
            cancel_reason = COALESCE(cancel_reason, 'Plan purchase refunded'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status != 'CANCELLED'
      `).bind(sub.id).run();
    }
  },
};
