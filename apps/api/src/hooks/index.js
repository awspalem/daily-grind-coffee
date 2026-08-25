import { loyaltyHooks } from './loyalty';
import { referralHooks } from './referral';
import { plansHooks } from './plans';
import { experiencesHooks } from './experiences';
import { profileHooks } from './profile';
const ALL = [loyaltyHooks, referralHooks, plansHooks, experiencesHooks, profileHooks];
/**
 * Fans a lifecycle event out to every feature. Deliberately `allSettled` and logged rather than
 * thrown: a loyalty-award failure must never turn a successfully-paid order into a 500 back to
 * Stripe, which would make Stripe retry the whole webhook.
 */
async function dispatch(name, env, ctx) {
    const results = await Promise.allSettled(ALL.map((hooks) => hooks[name]?.(env, ctx)).filter(Boolean));
    for (const r of results) {
        if (r.status === 'rejected')
            console.error(`[hooks] ${name} handler failed:`, r.reason);
    }
}
export const featureHooks = {
    onOrderPaid: (env, ctx) => dispatch('onOrderPaid', env, ctx),
    onOrderDelivered: (env, ctx) => dispatch('onOrderDelivered', env, ctx),
    onOrderRefunded: (env, ctx) => dispatch('onOrderRefunded', env, ctx),
};
