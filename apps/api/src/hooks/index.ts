import type { Env } from '../types/env';
import type { FeatureHooks } from './types';
import { loyaltyHooks } from './loyalty';
import { referralHooks } from './referral';
import { plansHooks } from './plans';
import { experiencesHooks } from './experiences';
import { profileHooks } from './profile';

const ALL: FeatureHooks[] = [loyaltyHooks, referralHooks, plansHooks, experiencesHooks, profileHooks];

/**
 * Fans a lifecycle event out to every feature. Deliberately `allSettled` and logged rather than
 * thrown: a loyalty-award failure must never turn a successfully-paid order into a 500 back to
 * Stripe, which would make Stripe retry the whole webhook.
 */
async function dispatch(name: keyof FeatureHooks, env: Env, ctx: any): Promise<void> {
  const results = await Promise.allSettled(
    ALL.map((hooks) => (hooks[name] as any)?.(env, ctx)).filter(Boolean)
  );
  for (const r of results) {
    if (r.status === 'rejected') console.error(`[hooks] ${name} handler failed:`, r.reason);
  }
}

export const featureHooks = {
  onOrderPaid: (env: Env, ctx: { orderId: string; order: any; items: any[] }) => dispatch('onOrderPaid', env, ctx),
  onOrderDelivered: (env: Env, ctx: { orderId: string; order: any }) => dispatch('onOrderDelivered', env, ctx),
  onOrderRefunded: (env: Env, ctx: { orderId: string; order: any }) => dispatch('onOrderRefunded', env, ctx),
};

export type { FeatureHooks } from './types';
