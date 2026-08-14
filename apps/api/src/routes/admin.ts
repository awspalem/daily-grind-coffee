import { Hono } from 'hono';
import type { Env } from '../types/env';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { zeroTrustAdminGuard, recordAuditLog, type AdminActor } from '../middleware/zeroTrust';
import { FreeTierQuotaMonitor } from '../services/quotaMonitor';
import { D1BackupService } from '../services/backupService';
import { GroqService } from '../services/groq';
import type { InventoryMovementType, OrderStatus } from '@daily-grind/shared-types';

const adminApp = new Hono<{ Bindings: Env; Variables: { adminActor: AdminActor } }>();

// Apply Zero Trust Admin Protection across all /api/admin routes
adminApp.use('*', zeroTrustAdminGuard);

// GET /api/admin/dashboard
adminApp.get('/dashboard', async (c) => {
  const db = c.env.DB;

  // 1. Order stats
  const totalSalesRow = await db.prepare(`
    SELECT 
      COUNT(id) as total_orders,
      COALESCE(SUM(CASE WHEN status != 'CANCELLED' AND status != 'REFUNDED' THEN total_cents ELSE 0 END), 0) as total_revenue_cents,
      COALESCE(AVG(CASE WHEN status != 'CANCELLED' AND status != 'REFUNDED' THEN total_cents ELSE NULL END), 0) as aov_cents
    FROM orders
  `).first<{ total_orders: number; total_revenue_cents: number; aov_cents: number }>();

  // 2. Orders by status
  const { results: statusCounts } = await db.prepare(`
    SELECT status, COUNT(id) as count FROM orders GROUP BY status
  `).all();

  // 3. Low stock count
  const lowStockRow = await db.prepare(`
    SELECT COUNT(*) as low_stock_count
    FROM inventory
    WHERE available_stock <= low_stock_threshold
  `).first<{ low_stock_count: number }>();

  // 4. Recent orders
  const { results: recentOrders } = await db.prepare(`
    SELECT id, order_number, customer_email, status, total_cents, created_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 8
  `).all();

  return c.json({
    success: true,
    stats: {
      total_orders: Number(totalSalesRow?.total_orders || 0),
      total_revenue_cents: Number(totalSalesRow?.total_revenue_cents || 0),
      aov_cents: Math.round(Number(totalSalesRow?.aov_cents || 0)),
      low_stock_count: Number(lowStockRow?.low_stock_count || 0),
      orders_by_status: statusCounts || [],
      recent_orders: recentOrders || [],
    },
  });
});

// GET /api/admin/inventory
adminApp.get('/inventory', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT 
      i.variant_id,
      i.sku,
      i.available_stock,
      i.reserved_stock,
      i.low_stock_threshold,
      i.last_restocked_at,
      i.updated_at,
      v.weight_grams,
      v.price_cents,
      p.id as product_id,
      p.name as product_name,
      p.roast_level,
      p.origin_country,
      p.image_url
    FROM inventory i
    JOIN product_variants v ON i.variant_id = v.id
    JOIN products p ON v.product_id = p.id
    ORDER BY p.name ASC, v.weight_grams ASC
  `).all();

  return c.json({ success: true, inventory: results || [] });
});

// POST /api/admin/inventory/adjust (Audited & Ledger backed)
adminApp.post('/inventory/adjust', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    variant_id: string;
    movement_type: InventoryMovementType;
    quantity_delta: number;
    reason?: string;
  }>();

  if (!body.variant_id || !body.movement_type || body.quantity_delta === undefined) {
    return c.json({ success: false, error: 'variant_id, movement_type, and quantity_delta are required' }, 400);
  }

  const ledger = new InventoryLedgerService(c.env.DB);
  try {
    const result = await ledger.recordMovement({
      variantId: body.variant_id,
      movementType: body.movement_type,
      delta: Number(body.quantity_delta),
      referenceType: 'ADMIN',
      reason: body.reason || 'Staff stock adjustment',
      actor: actor?.email || 'ADMIN_PORTAL',
    });

    // Record in Audit Log
    await recordAuditLog(
      c.env.DB,
      actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
      'INVENTORY_ADJUSTMENT',
      'variant_inventory',
      body.variant_id,
      null,
      { delta: body.quantity_delta, type: body.movement_type, newStock: result.newAvailableStock, reason: body.reason },
      c.req.header('CF-Connecting-IP')
    );

    return c.json({ success: true, new_available_stock: result.newAvailableStock });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// GET /api/admin/movements
adminApp.get('/movements', async (c) => {
  const limit = Math.min(100, Number(c.req.query('limit') || 50));
  const ledger = new InventoryLedgerService(c.env.DB);
  const movements = await ledger.getRecentMovements(limit);
  return c.json({ success: true, movements });
});

// GET /api/admin/orders
adminApp.get('/orders', async (c) => {
  const status = c.req.query('status');
  let query = 'SELECT * FROM orders';
  const params: unknown[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC LIMIT 50';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, orders: results || [] });
});

// POST /api/admin/orders/:id/status
adminApp.post('/orders/:id/status', async (c) => {
  const actor = c.get('adminActor');
  const orderId = c.req.param('id');
  const body = await c.req.json<{
    status: OrderStatus;
    tracking_number?: string;
    carrier?: string;
  }>();

  if (!body.status) {
    return c.json({ success: false, error: 'Status is required' }, 400);
  }

  const oldOrder = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();

  await c.env.DB.prepare(`
    UPDATE orders SET
      status = ?,
      tracking_number = COALESCE(?, tracking_number),
      carrier = COALESCE(?, carrier),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(body.status, body.tracking_number || null, body.carrier || null, orderId).run();

  // Audit Log
  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'ORDER_STATUS_UPDATE',
    'orders',
    orderId,
    { status: (oldOrder as any)?.status },
    { status: body.status, tracking: body.tracking_number },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, message: `Order ${orderId} updated to ${body.status}` });
});

// POST /api/admin/orders/:id/refund
adminApp.post('/orders/:id/refund', async (c) => {
  const actor = c.get('adminActor');
  const orderId = c.req.param('id');
  const body = await c.req.json<{ amount_cents?: number; reason: string }>();

  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>();
  if (!order) return c.json({ success: false, error: 'Order not found' }, 404);

  const refundCents = body.amount_cents || order.total_cents;
  const refundId = 'ref_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO refunds (id, order_id, payment_id, amount_cents, reason, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', ?)
    `).bind(refundId, orderId, order.stripe_payment_intent_id || 'mock_pay_id', refundCents, body.reason, actor.email),

    c.env.DB.prepare(`
      UPDATE orders SET status = 'REFUNDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(orderId)
  ]);

  await recordAuditLog(
    c.env.DB,
    actor,
    'ORDER_REFUND',
    'orders',
    orderId,
    { status: order.status },
    { status: 'REFUNDED', amount_cents: refundCents, reason: body.reason },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, refund_id: refundId, message: `Refunded $${(refundCents / 100).toFixed(2)}` });
});

// GET /api/admin/quotas (Free-Tier Capacity Telemetry)
adminApp.get('/quotas', async (c) => {
  const monitor = new FreeTierQuotaMonitor(c.env.DB, c.env.CONFIG_KV);
  const report = await monitor.getUsageReport();
  return c.json({ success: true, report });
});

// POST /api/admin/backup (Trigger automated D1 snapshot)
adminApp.post('/backup', async (c) => {
  const backupService = new D1BackupService(c.env.DB, c.env.MEDIA_BUCKET);
  const result = await backupService.performNightlyExport();
  return c.json(result);
});

// GET /api/admin/ai-summary (Operations Digest Agent)
adminApp.get('/ai-summary', async (c) => {
  const groq = new GroqService(c.env.GROQ_API_KEY, c.env.GROQ_MODEL);
  const { results: recentOrders } = await c.env.DB.prepare(
    'SELECT order_number, total_cents, status FROM orders ORDER BY created_at DESC LIMIT 10'
  ).all();

  const { results: lowStock } = await c.env.DB.prepare(
    'SELECT sku, available_stock, low_stock_threshold FROM inventory WHERE available_stock <= low_stock_threshold'
  ).all();

  const prompt = `
Generate a concise morning operational briefing for the Master Roaster:
- Recent Orders summary: ${JSON.stringify(recentOrders || [])}
- Low Stock items needing roasting: ${JSON.stringify(lowStock || [])}

Provide: 
1. Roasting batch priorities for today
2. Estimated production requirements
3. Quick operational sanity check
Keep it brief and formatted with bullet points.
  `;

  const summary = await groq.chatCompletion([{ role: 'user', content: prompt }]);
  return c.json({ success: true, summary: summary.content });
});

export { adminApp };
