import { qualifyReferral, reverseReferral } from '../services/referral';
/**
 * Referral lifecycle handlers.
 *
 * The referrer is paid here and nowhere else. Paying on delivery is the fraud guard that does
 * the most work: order-then-refund costs the attacker the shipping and earns them nothing.
 */
export const referralHooks = {
    async onOrderDelivered(env, { orderId }) {
        await qualifyReferral(env.DB, orderId);
    },
    async onOrderRefunded(env, { orderId }) {
        await reverseReferral(env.DB, orderId);
    },
};
