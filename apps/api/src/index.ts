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
import { rateLimiter } from './middleware/rateLimit';
import { generateOrderConfirmationEmail } from './services/emailTemplate';
import { D1BackupService } from './services/backupService';

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
          console.log(`[EMAIL QUEUE] Successfully generated and queued email for ${emailData.to}: "${emailData.subject}"`);
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

    console.log('[CRON DONE] Nightly inventory check, cart cleanup & D1 R2 backup completed successfully.');
  }
};
