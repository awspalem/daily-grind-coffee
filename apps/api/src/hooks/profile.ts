import type { Env } from '../types/env';
import type { FeatureHooks } from './types';
import { refreshTasteProfile } from '../services/customerProfile';

/** profile lifecycle handlers. Owned by one feature — implement only what this feature needs. */

/**
 * Rebuilds the taste-graph snapshot for whoever placed this order.
 *
 * The order is re-read by id rather than trusted from `ctx.order`: the hook contract types it as
 * `any` and onOrderDelivered doesn't carry items at all, so the only shape guaranteed to be
 * correct is the row in the database.
 *
 * A guest order (no matching `customers` row) is a no-op: there is nobody to attach a profile to,
 * and the row will be picked up on the customer's first authenticated read, since the snapshot is
 * computed from `customer_email` rather than `customer_id`.
 */
async function refreshFromOrder(env: Env, orderId: string): Promise<void> {
  const order = await env.DB
    .prepare('SELECT customer_id, customer_email FROM orders WHERE id = ?')
    .bind(orderId)
    .first<{ customer_id: string | null; customer_email: string }>();

  if (!order) return;

  const email = (order.customer_email || '').trim().toLowerCase();
  let customerId = order.customer_id;

  if (!customerId && email) {
    const customer = await env.DB
      .prepare('SELECT id FROM customers WHERE LOWER(email) = ?')
      .bind(email)
      .first<{ id: string }>();
    customerId = customer?.id ?? null;
  }

  if (!customerId || !email) return;

  await refreshTasteProfile(env.DB, customerId, email);
}

export const profileHooks: FeatureHooks = {
  // Payment is the moment an order starts counting toward LTV, AOV and cadence (see
  // COUNTED_STATUSES in services/customerProfile.ts), so the snapshot must move here...
  onOrderPaid: (env, ctx) => refreshFromOrder(env, ctx.orderId),

  // ...and again on delivery, which is when review signal typically starts arriving and when
  // the recency clock the segment depends on is most likely to have crossed a boundary.
  onOrderDelivered: (env, ctx) => refreshFromOrder(env, ctx.orderId),

  // A refund removes the order from the counted set entirely; without this the customer would
  // keep a lifetime value that includes money they got back.
  onOrderRefunded: (env, ctx) => refreshFromOrder(env, ctx.orderId),
};
