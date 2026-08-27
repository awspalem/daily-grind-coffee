import { awardForDeliveredOrder, awardSubscriptionStreak, refreshTier, resolveOrderCustomer, reverseOrder, } from '../services/loyalty';
/**
 * Loyalty lifecycle handlers.
 *
 * Accrual deliberately hangs off delivery rather than payment: points awarded at payment time
 * would have to be clawed back on every cancellation, and a balance that can vanish is worse
 * than one that arrives a few days late. The dispatcher is `allSettled`, so a throw here is
 * logged and never turns a courier webhook into a retry loop.
 */
/**
 * Surface a tier transition to the customer. The notification transport (email, push, in-app
 * inbox) is feature-agnostic and lives outside this feature's scope; today we emit a
 * structured log line that the notification tail-consumer picks up, and the JSON shape is the
 * contract. Flipping it to a real send is a one-import change once the inbox feature ships.
 */
async function notifyTierChange(customer, fromTier, toTier) {
    const direction = fromTier === null ? 'assigned' : rank(toTier) > rank(fromTier) ? 'upgrade' : 'downgrade';
    console.log(JSON.stringify({
        event: 'loyalty.tier_transition',
        customer_id: customer.id,
        customer_email: customer.email,
        from_tier: fromTier,
        to_tier: toTier,
        direction,
        at: new Date().toISOString(),
    }));
}
function rank(tier) {
    return { BRONZE: 0, SILVER: 1, GOLD: 2 }[tier] ?? 0;
}
export const loyaltyHooks = {
    async onOrderDelivered(env, { orderId, order }) {
        const customer = await resolveOrderCustomer(env.DB, order);
        if (!customer)
            return; // genuine guest checkout — nothing to credit
        const previousTier = customer.loyalty_tier;
        await awardForDeliveredOrder(env.DB, customer, {
            id: orderId,
            subtotal_cents: Number(order.subtotal_cents || 0),
            discount_cents: Number(order.discount_cents || 0),
        });
        await awardSubscriptionStreak(env.DB, customer, orderId);
        // Re-evaluate the tier last: this delivery may have just tipped the trailing-12-month spend
        // over a threshold, and the perk grants hang off that.
        const info = await refreshTier(env.DB, customer);
        if (info.tier !== previousTier) {
            await notifyTierChange(customer, previousTier, info.tier);
        }
    },
    async onOrderRefunded(env, { orderId, order }) {
        const customer = await resolveOrderCustomer(env.DB, order);
        if (!customer)
            return;
        const previousTier = customer.loyalty_tier;
        await reverseOrder(env.DB, customer.id, orderId);
        const info = await refreshTier(env.DB, customer);
        if (info.tier !== previousTier) {
            await notifyTierChange(customer, previousTier, info.tier);
        }
    },
};
