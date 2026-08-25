import type { Env } from '../types/env';

/**
 * Lifecycle events that features react to. Each feature implements only the handlers it cares
 * about, in its own file under this directory, so no feature ever has to edit webhooks.ts.
 */
export interface FeatureHooks {
  /** Payment confirmed for an order (Stripe checkout.session.completed / payment_intent.succeeded). */
  onOrderPaid?(env: Env, ctx: { orderId: string; order: any; items: any[] }): Promise<void>;

  /** Courier reported the parcel delivered — the point at which rewards become non-reversible. */
  onOrderDelivered?(env: Env, ctx: { orderId: string; order: any }): Promise<void>;

  /** An order was refunded; anything granted at paid/delivered time should be clawed back. */
  onOrderRefunded?(env: Env, ctx: { orderId: string; order: any }): Promise<void>;
}
