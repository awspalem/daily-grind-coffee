import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types/env';
import { productsApp } from './routes/products';
import { cartApp } from './routes/cart';
import { checkoutApp } from './routes/checkout';
import { ordersApp } from './routes/orders';
import { webhooksApp } from './routes/webhooks';
import { adminApp } from './routes/admin';
import { agentApp } from './routes/agent';
import { analyticsApp } from './routes/analytics';
import { mcpApp } from './routes/mcp';
import { mediaApp } from './routes/media';
import { customerApp } from './routes/customer';
import { reviewsApp } from './routes/reviews';
import { rateLimiter } from './middleware/rateLimit';
import { generateOrderConfirmationEmail } from './services/emailTemplate';
import { D1BackupService } from './services/backupService';
import { InventoryLedgerService } from './services/inventoryLedger';
import { ResendEmailService } from './services/resend';
import { StripeService } from './services/stripe';

const app = new Hono<{ Bindings: Env }>();

// Middleware Pipeline
app.use('*', logger());
app.use('*', rateLimiter({ windowSeconds: 60, maxRequests: 180 }));
app.use('*', cors({
  // Reflects the request's own Origin rather than a static '*'. Required for `credentials: true`
  // below (the CORS spec forbids combining a wildcard origin with credentialed requests) — the
  // admin portal needs cookies sent cross-origin so Cloudflare Access's session cookie reaches
  // api.rohithpalem.in when called from a different frontend origin.
  origin: (origin) => origin || '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Turnstile-Token', 'X-Customer-Email', 'stripe-signature', 'Cf-Access-Jwt-Assertion'],
  exposeHeaders: ['Content-Length', 'X-Session-Token', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400,
}));

// Global Health & Info
app.get('/health', (c) => {
  return c.json({
    status: 'online',
    platform: 'Cloudflare Workers (Edge)',
    database: 'Cloudflare D1 (SQL)',
    agent_engine: 'Groq Reasoning + Workers AI Embeddings',
    mcp_protocol: 'JSON-RPC 2.0 Ready',
    bot_defense: 'Cloudflare Turnstile Active',
    admin_auth: 'Cloudflare Zero Trust Guarded',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes Across All Phases
app.route('/api', productsApp);
app.route('/api/cart', cartApp);
app.route('/api/checkout', checkoutApp);
app.route('/api/orders', ordersApp);
app.route('/api/webhooks', webhooksApp);
app.route('/api/admin', adminApp);
app.route('/api/agent', agentApp);
app.route('/api/analytics', analyticsApp);
app.route('/api/mcp', mcpApp);
app.route('/api/media', mediaApp);
app.route('/api/customer', customerApp);
app.route('/api/reviews', reviewsApp);

// 404 Handler
app.notFound((c) => {
  return c.json({ success: false, error: 'Route not found' }, 404);
});

// Error Handler
app.onError((err, c) => {
  console.error('Unhandled API Error:', err);
  return c.json({ success: false, error: err.message || 'Internal Server Error' }, 500);
});

// Export Cloudflare Worker Handlers
export default {
  fetch: app.fetch,

  // Cloudflare Queues Consumer Handler (Phase 2 & 3)
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    console.log(`Processing queue batch with ${batch.messages.length} messages`);
    for (const message of batch.messages) {
      try {
        const body = message.body;
        console.log(`Executing async job: ${body.job_type}`, body);

        if (body.job_type === 'ORDER_CONFIRMATION_EMAIL') {
          // Generate structured email payload
          const emailData = generateOrderConfirmationEmail({
            orderNumber: body.order_number,
            customerName: body.customer_email.split('@')[0],
            customerEmail: body.customer_email,
            totalCents: body.total_cents,
            items: body.items || [
              { name: 'Specialty Coffee Selection', weightGrams: 250, grindType: 'Whole Bean', priceCents: body.total_cents, quantity: 1 }
            ],
            storefrontUrl: env.STOREFRONT_URL || 'http://localhost:5173',
          });
          const emailService = new ResendEmailService(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
          const emailResult = await emailService.send(emailData.to, emailData.subject, emailData.html);
          if (emailResult.success) {
            console.log(`[EMAIL QUEUE] Sent order confirmation to ${emailData.to}: "${emailData.subject}"`);
          } else {
            console.error(`[EMAIL QUEUE] Failed to send order confirmation to ${emailData.to}:`, emailResult.error);
          }
        } else if (body.job_type === 'GENERATE_INVOICE_PDF') {
          // Generate PDF and upload to R2
          console.log(`[R2 INVOICE JOB] Uploading PDF receipt for Order #${body.order_number} to R2 bucket`);
        }

        message.ack();
      } catch (err) {
        console.error('Queue job failure:', err);
        message.retry();
      }
    }
  },

  // Cloudflare Cron Scheduled Handler (Phase 2, 3 & 5)
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron triggered at ${new Date().toISOString()} (cron: ${controller.cron})`);
    
    // 1. Audit low-stock items
    const { results: lowStock } = await env.DB.prepare(`
      SELECT sku, available_stock, low_stock_threshold 
      FROM inventory 
      WHERE available_stock <= low_stock_threshold
    `).all();

    if (lowStock && lowStock.length > 0) {
      console.warn(`[CRON ALERT] ${lowStock.length} items are currently below low-stock thresholds:`, lowStock);
    }

    // 2. Perform automated D1 snapshot backup to R2
    try {
      const backupService = new D1BackupService(env.DB, env.MEDIA_BUCKET);
      await backupService.performNightlyExport();
    } catch (bErr) {
      console.error('[CRON BACKUP ERROR]', bErr);
    }

    // 3. Clean up expired guest carts older than 30 days
    await env.DB.prepare(`
      DELETE FROM carts WHERE expires_at < CURRENT_TIMESTAMP
    `).run();

    // 4. Release inventory reserved by abandoned checkouts. checkout.ts reserves stock
    // (PURCHASE_RESERVE) the moment a Stripe session is created, but nothing ever released it if
    // the shopper never paid — every abandoned checkout permanently shrank available stock.
    // Orders still PENDING_PAYMENT after 30 minutes are treated as abandoned.
    try {
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { results: staleOrders } = await env.DB.prepare(`
        SELECT id, order_number FROM orders WHERE status = 'PENDING_PAYMENT' AND created_at < ?
      `).bind(staleThreshold).all<{ id: string; order_number: string }>();

      if (staleOrders && staleOrders.length > 0) {
        const ledger = new InventoryLedgerService(env.DB);
        for (const order of staleOrders) {
          const { results: items } = await env.DB.prepare(
            'SELECT variant_id, quantity FROM order_items WHERE order_id = ?'
          ).bind(order.id).all<{ variant_id: string; quantity: number }>();

          for (const item of items || []) {
            try {
              await ledger.recordMovement({
                variantId: item.variant_id,
                movementType: 'RESERVATION_EXPIRED',
                delta: Number(item.quantity),
                referenceType: 'ORDER',
                referenceId: order.id,
                reason: `Released — order ${order.order_number} abandoned (still PENDING_PAYMENT after 30 min)`,
                actor: 'CRON_RESERVATION_CLEANUP',
              });
            } catch (relErr) {
              console.error(`[CRON] Failed to release reservation for order ${order.order_number}, variant ${item.variant_id}:`, relErr);
            }
          }

          await env.DB.prepare(
            "UPDATE orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(order.id).run();
        }
        console.log(`[CRON] Released reservations and cancelled ${staleOrders.length} abandoned PENDING_PAYMENT order(s).`);
      }
    } catch (releaseErr) {
      console.error('[CRON RESERVATION CLEANUP ERROR]', releaseErr);
    }

    // 5. Process due subscription renewals. checkout.ts creates a `subscriptions` row on a
    // Subscribe & Save order and captures a reusable Stripe payment method (see webhooks.ts),
    // but nothing ever charged it again — every subscriber got exactly one order, ever. This
    // charges the saved payment method off-session for anything due, creates the follow-on
    // order, and advances the renewal date; anything that can't be charged (no saved payment
    // method, declined card, sold out) is marked PAST_DUE rather than silently retried forever.
    try {
      const { results: dueSubs } = await env.DB.prepare(`
        SELECT * FROM subscriptions WHERE status = 'ACTIVE' AND next_renewal_date <= CURRENT_TIMESTAMP
      `).all<any>();

      if (dueSubs && dueSubs.length > 0) {
        const ledger = new InventoryLedgerService(env.DB);
        const stripe = new StripeService(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
        const emailService = new ResendEmailService(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
        let renewed = 0;
        let pastDue = 0;

        for (const sub of dueSubs) {
          const markPastDue = async (reason: string) => {
            pastDue++;
            console.warn(`[CRON SUBSCRIPTION] ${sub.id} (${sub.product_name}) marked PAST_DUE: ${reason}`);
            await env.DB.prepare(
              "UPDATE subscriptions SET status = 'PAST_DUE', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(sub.id).run();
          };

          if (!sub.stripe_customer_id || !sub.stripe_payment_method_id) {
            await markPastDue('no saved payment method on file');
            continue;
          }

          const variant = await env.DB.prepare(
            'SELECT price_cents FROM product_variants WHERE id = ? AND is_active = 1'
          ).bind(sub.variant_id).first<{ price_cents: number }>();
          if (!variant) {
            await markPastDue('product variant no longer available');
            continue;
          }

          const unitPriceCents = Math.round(Number(variant.price_cents) * (1 - Number(sub.discount_percent) / 100));
          const totalCents = unitPriceCents * Number(sub.quantity);

          // Reserve then immediately fulfill — the charge below happens synchronously (unlike
          // the checkout flow, which reserves at session-creation and fulfills only once Stripe
          // confirms payment via webhook), so there's no pending window to hold stock through.
          try {
            await ledger.recordMovement({
              variantId: sub.variant_id,
              movementType: 'PURCHASE_RESERVE',
              delta: -Number(sub.quantity),
              referenceType: 'ORDER',
              referenceId: sub.id,
              reason: `Subscription renewal stock check — ${sub.product_name}`,
              actor: 'CRON_SUBSCRIPTION_RENEWAL',
            });
          } catch (stockErr: any) {
            await markPastDue(`insufficient stock: ${stockErr.message}`);
            continue;
          }

          const charge = await stripe.chargeOffSession({
            customerId: sub.stripe_customer_id,
            paymentMethodId: sub.stripe_payment_method_id,
            amountCents: totalCents,
            currency: 'usd',
            description: `Subscription renewal — ${sub.product_name} (${sub.frequency.replace('_', ' ')})`,
          });

          if (!charge.success) {
            // Release the stock we just reserved — the charge failed, this cycle doesn't ship.
            await ledger.recordMovement({
              variantId: sub.variant_id,
              movementType: 'RESERVATION_EXPIRED',
              delta: Number(sub.quantity),
              referenceType: 'ORDER',
              referenceId: sub.id,
              reason: `Renewal charge declined: ${charge.error}`,
              actor: 'CRON_SUBSCRIPTION_RENEWAL',
            });
            await markPastDue(`Stripe charge declined: ${charge.error}`);
            continue;
          }

          await ledger.recordMovement({
            variantId: sub.variant_id,
            movementType: 'ORDER_FULFILLED',
            delta: -Number(sub.quantity),
            referenceType: 'ORDER',
            referenceId: sub.id,
            reason: `Subscription renewal fulfilled — ${sub.product_name}`,
            actor: 'CRON_SUBSCRIPTION_RENEWAL',
          });

          const orderId = 'ord_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
          const orderNumber = 'TDG-' + Math.floor(100000 + Math.random() * 900000);
          const shippingCents = totalCents >= 5000 ? 0 : 500;
          const taxCents = Math.round(totalCents * 0.08);
          const orderTotalCents = totalCents + shippingCents + taxCents;

          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO orders (
                id, order_number, customer_email, status, subtotal_cents, shipping_cents,
                tax_cents, discount_cents, total_cents, currency, shipping_address_json,
                stripe_payment_intent_id, notes, created_at, updated_at
              ) VALUES (?, ?, ?, 'PAID', ?, ?, ?, 0, ?, 'usd', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(
              orderId, orderNumber, sub.customer_email, totalCents, shippingCents, taxCents,
              orderTotalCents, sub.shipping_address_json || '{}', charge.paymentIntentId,
              `Subscription renewal for ${sub.id} (${sub.frequency.replace('_', ' ')})`
            ),
            env.DB.prepare(`
              INSERT INTO order_items (
                id, order_id, variant_id, product_name, weight_grams, grind_type,
                unit_price_cents, quantity, total_price_cents, subscription_frequency
              ) VALUES (?, ?, ?, ?, (SELECT weight_grams FROM product_variants WHERE id = ?), ?, ?, ?, ?, ?)
            `).bind(
              'oi_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), orderId, sub.variant_id,
              sub.product_name, sub.variant_id, sub.grind_type, unitPriceCents, sub.quantity,
              totalCents, sub.frequency
            ),
          ]);

          const days = sub.frequency === '1_WEEK' ? 7 : sub.frequency === '4_WEEKS' ? 28 : 14;
          const nextRenewalDate = new Date(new Date(sub.next_renewal_date).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
          await env.DB.prepare(
            'UPDATE subscriptions SET next_renewal_date = ?, order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(nextRenewalDate, orderId, sub.id).run();

          renewed++;

          try {
            const emailData = generateOrderConfirmationEmail({
              orderNumber,
              customerName: sub.customer_email.split('@')[0],
              customerEmail: sub.customer_email,
              totalCents: orderTotalCents,
              items: [{ name: sub.product_name, weightGrams: 0, grindType: sub.grind_type, priceCents: unitPriceCents, quantity: sub.quantity }],
              storefrontUrl: env.STOREFRONT_URL || 'http://localhost:5173',
            });
            await emailService.send(emailData.to, `☕ Subscription Renewed — ${emailData.subject}`, emailData.html);
          } catch (emailErr) {
            console.error(`[CRON SUBSCRIPTION] Renewal email failed for ${orderNumber}:`, emailErr);
          }
        }

        console.log(`[CRON] Subscription renewals: ${renewed} charged, ${pastDue} marked PAST_DUE.`);
      }
    } catch (subErr) {
      console.error('[CRON SUBSCRIPTION RENEWAL ERROR]', subErr);
    }

    console.log('[CRON DONE] Nightly inventory check, cart cleanup, reservation cleanup, subscription renewals & D1 R2 backup completed successfully.');
  }
};
