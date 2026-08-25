import type { FeatureHooks } from './types';
import {
  awardForDeliveredOrder,
  awardSubscriptionStreak,
  refreshTier,
  resolveOrderCustomer,
  reverseOrder,
} from '../services/loyalty';

/**
 * Loyalty lifecycle handlers.
 *
 * Accrual deliberately hangs off delivery rather than payment: points awarded at payment time
 * would have to be clawed back on every cancellation, and a balance that can vanish is worse
 * than one that arrives a few days late. The dispatcher is `allSettled`, so a throw here is
 * logged and never turns a courier webhook into a retry loop.
 */
export const loyaltyHooks: FeatureHooks = {
  async onOrderDelivered(env, { orderId, order }) {
    const customer = await resolveOrderCustomer(env.DB, order);
    if (!customer) return; // genuine guest checkout — nothing to credit

    await awardForDeliveredOrder(env.DB, customer, {
      id: orderId,
      subtotal_cents: Number(order.subtotal_cents || 0),
      discount_cents: Number(order.discount_cents || 0),
    });
    await awardSubscriptionStreak(env.DB, customer, orderId);

    // Re-evaluate the tier last: this delivery may have just tipped the trailing-12-month spend
    // over a threshold, and the perk grants hang off that.
    await refreshTier(env.DB, customer);
  },

  async onOrderRefunded(env, { orderId, order }) {
    const customer = await resolveOrderCustomer(env.DB, order);
    if (!customer) return;

    await reverseOrder(env.DB, customer.id, orderId);
    await refreshTier(env.DB, customer);
  },
};
