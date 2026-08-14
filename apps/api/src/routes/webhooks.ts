import { Hono } from 'hono';
import type { Env } from '../types/env';
import { StripeService } from '../services/stripe';
import { InventoryLedgerService } from '../services/inventoryLedger';

const webhooksApp = new Hono<{ Bindings: Env }>();

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

        // Send job to Cloudflare Queue if bound
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

export { webhooksApp };
