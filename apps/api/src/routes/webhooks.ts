import { Hono } from 'hono';
import type { Env } from '../types/env';
import { StripeService } from '../services/stripe';
import { featureHooks } from '../hooks';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { ResendEmailService } from '../services/resend';
import { generateOrderConfirmationEmail } from '../services/emailTemplate';

const webhooksApp = new Hono<{ Bindings: Env }>();

// Maps Shiprocket's known courier status strings onto our internal order lifecycle.
// Exact matches only — substring checks misclassify statuses like "UNDELIVERED" as delivered.
const SHIPROCKET_STATUS_MAP: Record<string, string> = {
  'PICKUP SCHEDULED': 'PACKED',
  'PICKED UP': 'SHIPPED',
  'SHIPPED': 'SHIPPED',
  'IN TRANSIT': 'SHIPPED',
  'OUT FOR DELIVERY': 'SHIPPED',
  'DELIVERED': 'DELIVERED',
};

// Forward-only lifecycle so a delayed/out-of-order webhook can't regress a later status.
const ORDER_STATUS_RANK: Record<string, number> = {
  PENDING_PAYMENT: 0,
  PAID: 1,
  ROASTING: 2,
  PACKED: 3,
  SHIPPED: 4,
  DELIVERED: 5,
  CANCELLED: 5,
  REFUNDED: 5,
};

function mapShiprocketStatus(currentStatus?: string): string | null {
  const status = (currentStatus || '').trim().toUpperCase();
  if (!status) return null;
  return SHIPROCKET_STATUS_MAP[status] || null;
}

// POST /api/stripe/webhook
webhooksApp.post('/stripe', async (c) => {
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header('stripe-signature');
  const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);

  // 1. Verify Webhook Signature
  const isValid = await stripe.verifyWebhookSignature(rawBody, signatureHeader);
  if (!isValid) {
    console.error('Invalid Stripe webhook signature');
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const eventId = event.id || 'evt_sim_' + Date.now();
  const eventType = event.type || 'unknown';

  // 2. Idempotency Check in D1
  const existingEvent = await c.env.DB.prepare(
    'SELECT id FROM webhook_events WHERE id = ?'
  ).bind(eventId).first();

  if (existingEvent) {
    console.log(`Stripe event ${eventId} already processed. Skipping.`);
    return c.json({ received: true, deduplicated: true }, 200);
  }

  // 3. Process Stripe Event
  const ledger = new InventoryLedgerService(c.env.DB);

  if (eventType === 'checkout.session.completed' || eventType === 'payment_intent.succeeded') {
    const session = event.data?.object || {};
    const orderId = session.client_reference_id || session.metadata?.order_id;
    const paymentIntentId = session.payment_intent || session.id || 'pi_sim_' + Date.now();
    const amountCents = Number(session.amount_total || session.amount || 0);

    if (orderId) {
      // Find order and items
      const order = await c.env.DB.prepare(
        'SELECT * FROM orders WHERE id = ?'
      ).bind(orderId).first<any>();

      if (order && order.status !== 'PAID') {
        const { results: items } = await c.env.DB.prepare(
          'SELECT * FROM order_items WHERE order_id = ?'
        ).bind(orderId).all();

        const paymentId = 'pay_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

        // Execute batch atomic updates
        const batchStatements = [
          // Record webhook event for idempotency
          c.env.DB.prepare(`
            INSERT INTO webhook_events (id, provider, event_type, status, payload_json)
            VALUES (?, 'STRIPE', ?, 'PROCESSED', ?)
          `).bind(eventId, eventType, rawBody),

          // Update order status
          c.env.DB.prepare(`
            UPDATE orders SET
              status = 'PAID',
              stripe_payment_intent_id = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(paymentIntentId, orderId),

          // Record payment record
          c.env.DB.prepare(`
            INSERT INTO payments (
              id, order_id, stripe_payment_intent_id, amount_cents, currency, status, payment_method_type, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', 'card', ?)
          `).bind(paymentId, orderId, paymentIntentId, amountCents || order.total_cents, order.currency || 'usd', eventId),
        ];

        await c.env.DB.batch(batchStatements);

        // Convert reserved inventory to fulfilled
        for (const item of (items || []) as any[]) {
          await ledger.recordMovement({
            variantId: item.variant_id,
            movementType: 'ORDER_FULFILLED',
            delta: -Number(item.quantity),
            referenceType: 'ORDER',
            referenceId: orderId,
            reason: `Order ${order.order_number} payment confirmed`,
            actor: 'STRIPE_WEBHOOK',
          });
        }

        // Let features react to the paid order (loyalty accrual, referral attribution, plan
        // entitlement grants). Failures are logged inside the dispatcher, never surfaced to
        // Stripe as a 500 — that would trigger a retry of the whole webhook.
        await featureHooks.onOrderPaid(c.env, { orderId, order, items: (items || []) as any[] });

        // If this order created Subscribe & Save rows, capture the Stripe customer + saved
        // payment method from this session so the renewal cron (index.ts scheduled()) can
        // charge future cycles off-session without the shopper re-entering card details.
        const stripeSessionId = session.id;
        if (stripeSessionId) {
          const { customerId, paymentMethodId } = await stripe.getSessionBillingDetails(stripeSessionId);
          if (customerId && paymentMethodId) {
            await c.env.DB.prepare(`
              UPDATE subscriptions SET stripe_customer_id = ?, stripe_payment_method_id = ?, updated_at = CURRENT_TIMESTAMP
              WHERE order_id = ?
            `).bind(customerId, paymentMethodId, orderId).run();
          }
        }

        // Send job to Cloudflare Queue if bound (Queues requires a paid Workers plan and isn't
        // currently enabled — see wrangler.toml — so this is best-effort for when it is).
        if (c.env.JOB_QUEUE) {
          try {
            await c.env.JOB_QUEUE.send({
              job_type: 'ORDER_CONFIRMATION_EMAIL',
              order_id: orderId,
              order_number: order.order_number,
              customer_email: order.customer_email,
              total_cents: order.total_cents,
              created_at: new Date().toISOString(),
            });
          } catch (qErr) {
            console.error('Queue send error:', qErr);
          }
        } else {
          // No queue available — send the confirmation email directly and synchronously instead
          // of silently dropping it (which is what happened before: the queue path was the only
          // one that ever sent an email, and it never fires without the paid plan).
          try {
            const emailData = generateOrderConfirmationEmail({
              orderNumber: order.order_number,
              customerName: order.customer_email.split('@')[0],
              customerEmail: order.customer_email,
              totalCents: order.total_cents,
              items: (items || []).map((it: any) => ({
                name: it.product_name,
                weightGrams: Number(it.weight_grams),
                grindType: it.grind_type,
                priceCents: Number(it.unit_price_cents),
                quantity: Number(it.quantity),
              })),
              storefrontUrl: c.env.STOREFRONT_URL || 'http://localhost:5173',
            });
            const emailService = new ResendEmailService(c.env.RESEND_API_KEY, c.env.RESEND_FROM_EMAIL);
            const emailResult = await emailService.send(emailData.to, emailData.subject, emailData.html);
            if (!emailResult.success) {
              console.error(`Order confirmation email not sent for ${order.order_number}:`, emailResult.error);
            }
          } catch (emailErr) {
            console.error('Order confirmation email generation/send error:', emailErr);
          }
        }

        console.log(`Successfully completed payment fulfillment for Order ${order.order_number}`);
      }
    }
  } else {
    // Record other webhook types for audit trail
    await c.env.DB.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, status, payload_json)
      VALUES (?, 'STRIPE', ?, 'RECEIVED', ?)
    `).bind(eventId, eventType, rawBody).run();
  }

  return c.json({ received: true }, 200);
});

// POST /api/webhooks/shiprocket
// Configure this URL (STOREFRONT/API domain + /api/webhooks/shiprocket) in the Shiprocket
// dashboard under Settings > API > Webhooks, along with a secret token matching
// SHIPROCKET_WEBHOOK_TOKEN, sent back on every call as the `x-api-key` header.
webhooksApp.post('/shiprocket', async (c) => {
  // Fail closed unconditionally — this mutates order status by order_number,
  // so it must never depend on an env string. Set SHIPROCKET_WEBHOOK_TOKEN in
  // .dev.vars for local testing (see .dev.vars.example).
  const expectedToken = c.env.SHIPROCKET_WEBHOOK_TOKEN;
  const providedToken = c.req.header('x-api-key');
  if (!expectedToken || providedToken !== expectedToken) {
    console.error('Invalid or missing Shiprocket webhook token');
    return c.json({ error: 'Invalid webhook token' }, 401);
  }

  let event: any;
  try {
    event = await c.req.json();
  } catch (err) {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const shipmentId = event.shipment_id || event.shipment_id_1 ? String(event.shipment_id || event.shipment_id_1) : undefined;
  const orderNumber = event.order_id ? String(event.order_id) : undefined;
  const awb = event.awb || event.awb_code || undefined;
  const courierName = event.courier_name || undefined;
  const currentStatus = event.current_status || event.shipment_status || undefined;

  let order = shipmentId
    ? await c.env.DB.prepare('SELECT * FROM orders WHERE shiprocket_shipment_id = ?').bind(shipmentId).first<any>()
    : null;

  // Fall back to order_number — covers the case where our Shiprocket order-create call
  // failed after the order was created on Shiprocket's side, so shiprocket_shipment_id
  // was never persisted locally.
  if (!order && orderNumber) {
    order = await c.env.DB.prepare('SELECT * FROM orders WHERE order_number = ?').bind(orderNumber).first<any>();
  }

  if (!order) {
    console.log('Shiprocket webhook: no matching order for shipment', shipmentId, orderNumber);
    return c.json({ received: true, matched: false }, 200);
  }

  if (shipmentId && !order.shiprocket_shipment_id) {
    await c.env.DB.prepare('UPDATE orders SET shiprocket_shipment_id = ? WHERE id = ?').bind(shipmentId, order.id).run();
  }

  let mappedStatus = mapShiprocketStatus(currentStatus);
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    // Terminal states — a courier update should never override a cancellation/refund.
    mappedStatus = null;
  } else if (mappedStatus && ORDER_STATUS_RANK[mappedStatus] < ORDER_STATUS_RANK[order.status]) {
    // Don't let a delayed/out-of-order webhook regress an already-later status.
    mappedStatus = null;
  }

  await c.env.DB.prepare(`
    UPDATE orders SET
      status = COALESCE(?, status),
      tracking_number = COALESCE(?, tracking_number),
      carrier = COALESCE(?, carrier),
      shiprocket_status = COALESCE(?, shiprocket_status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(mappedStatus, awb || null, courierName || null, currentStatus || null, order.id).run();

  if (mappedStatus === 'DELIVERED') {
    // Delivery is the point at which rewards stop being reversible — referral payouts and
    // loyalty accrual hang off this, not off payment.
    await featureHooks.onOrderDelivered(c.env, { orderId: order.id, order: { ...order, status: 'DELIVERED' } });
  }

  return c.json({ received: true, matched: true }, 200);
});

export { webhooksApp };
