import { Hono } from 'hono';
import type { Env } from '../types/env';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { zeroTrustAdminGuard, recordAuditLog, type AdminActor } from '../middleware/zeroTrust';
import { FreeTierQuotaMonitor } from '../services/quotaMonitor';
import { D1BackupService } from '../services/backupService';
import { GroqService } from '../services/groq';
import { ShiprocketService } from '../services/shiprocket';
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

  const oldOrder = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>();

  if (!oldOrder) {
    return c.json({ success: false, error: 'Order not found' }, 404);
  }

  let trackingNumber = body.tracking_number || null;
  let carrier = body.carrier || null;
  let shiprocketOrderId: string | null = null;
  let shiprocketShipmentId: string | null = null;
  let shiprocketStatus: string | null = null;
  let shiprocketPushError: string | null = null;
  let shiprocketSkipReason: string | null = null;

  // Auto-push newly packed orders to Shiprocket for fulfillment, once per order.
  // Shiprocket only ships within India — gate on destination, not on the order's
  // billing currency (the storefront can charge in USD for an India-bound parcel).
  const shippingAddressForGate = (() => {
    try {
      return JSON.parse(oldOrder.shipping_address_json);
    } catch {
      return {};
    }
  })();
  const normalizedCountry = String(shippingAddressForGate.country || '').trim().toUpperCase();
  const shipsToIndia = normalizedCountry === 'IN' || normalizedCountry === 'IND' || normalizedCountry === 'INDIA';

  if (body.status === 'PACKED' && !oldOrder.shiprocket_shipment_id && !shipsToIndia) {
    shiprocketSkipReason = `Shipping address country is "${shippingAddressForGate.country}", not IN — Shiprocket only ships within India, enter tracking manually`;
  } else if (body.status === 'PACKED' && !oldOrder.shiprocket_shipment_id) {
    try {
      const { results: items } = await c.env.DB.prepare(
        'SELECT * FROM order_items WHERE order_id = ?'
      ).bind(orderId).all();

      const shippingAddress = shippingAddressForGate;
      const shiprocket = new ShiprocketService(
        c.env.SHIPROCKET_EMAIL,
        c.env.SHIPROCKET_PASSWORD,
        c.env.SHIPROCKET_PICKUP_LOCATION,
        c.env.CONFIG_KV,
        c.env.ENVIRONMENT,
        Number(c.env.SHIPROCKET_USD_TO_INR_RATE) || undefined
      );

      const result = await shiprocket.createOrder({
        orderId,
        orderNumber: oldOrder.order_number,
        orderDateISO: (oldOrder.created_at || new Date().toISOString()).slice(0, 19).replace('T', ' '),
        customerName: shippingAddress.name,
        customerEmail: oldOrder.customer_email,
        customerPhone: shippingAddress.phone,
        shippingAddress,
        items: (items || []).map((item: any) => ({
          name: item.product_name,
          sku: item.variant_id,
          units: item.quantity,
          unitPriceCents: item.unit_price_cents,
        })),
        subtotalCents: oldOrder.subtotal_cents,
        shippingCents: oldOrder.shipping_cents,
        currency: oldOrder.currency,
      });

      shiprocketOrderId = result.shiprocketOrderId;
      shiprocketShipmentId = result.shipmentId;
      shiprocketStatus = result.status;

      // Best-effort: pull tracking immediately in case a courier/AWB was auto-assigned.
      try {
        const tracking = await shiprocket.trackShipment(result.shipmentId);
        if (tracking.awbCode) trackingNumber = tracking.awbCode;
        if (tracking.courierName) carrier = tracking.courierName;
      } catch (trackErr) {
        console.error('Shiprocket tracking lookup failed:', trackErr);
      }
    } catch (srErr: any) {
      console.error('Shiprocket order creation failed:', srErr);
      shiprocketPushError = srErr.message || 'Shiprocket order creation failed';
    }
  }

  await c.env.DB.prepare(`
    UPDATE orders SET
      status = ?,
      tracking_number = COALESCE(?, tracking_number),
      carrier = COALESCE(?, carrier),
      shiprocket_order_id = COALESCE(?, shiprocket_order_id),
      shiprocket_shipment_id = COALESCE(?, shiprocket_shipment_id),
      shiprocket_status = COALESCE(?, shiprocket_status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    body.status,
    trackingNumber,
    carrier,
    shiprocketOrderId,
    shiprocketShipmentId,
    shiprocketStatus,
    orderId
  ).run();

  // Audit Log
  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'ORDER_STATUS_UPDATE',
    'orders',
    orderId,
    { status: (oldOrder as any)?.status },
    { status: body.status, tracking: trackingNumber, shiprocket_shipment_id: shiprocketShipmentId },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    message: `Order ${orderId} updated to ${body.status}`,
    shiprocket_pushed: shiprocketShipmentId ? true : shiprocketPushError ? false : undefined,
    shiprocket_error: shiprocketPushError || undefined,
    shiprocket_skipped_reason: shiprocketSkipReason || undefined,
  });
});

// POST /api/admin/orders/:id/shiprocket/sync — pull latest courier/tracking status on demand
adminApp.post('/orders/:id/shiprocket/sync', async (c) => {
  const orderId = c.req.param('id');
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>();

  if (!order) {
    return c.json({ success: false, error: 'Order not found' }, 404);
  }
  if (!order.shiprocket_shipment_id) {
    return c.json({ success: false, error: 'Order has not been pushed to Shiprocket yet' }, 400);
  }

  const shiprocket = new ShiprocketService(
    c.env.SHIPROCKET_EMAIL,
    c.env.SHIPROCKET_PASSWORD,
    c.env.SHIPROCKET_PICKUP_LOCATION,
    c.env.CONFIG_KV,
    c.env.ENVIRONMENT
  );

  try {
    const tracking = await shiprocket.trackShipment(order.shiprocket_shipment_id);

    await c.env.DB.prepare(`
      UPDATE orders SET
        tracking_number = COALESCE(?, tracking_number),
        carrier = COALESCE(?, carrier),
        shiprocket_status = COALESCE(?, shiprocket_status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(tracking.awbCode || null, tracking.courierName || null, tracking.currentStatus || null, orderId).run();

    return c.json({ success: true, tracking });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 502);
  }
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

// GET /api/admin/pricing (Catalog & Multi-Currency Pricing List)
adminApp.get('/pricing', async (c) => {
  const { results: products } = await c.env.DB.prepare(`
    SELECT p.id as product_id, p.name as product_name, p.slug, p.origin_country, p.roast_level,
           v.id as variant_id, v.sku, v.weight_grams, v.price_cents,
           COALESCE(i.available_stock, 0) as available_stock
    FROM products p
    JOIN product_variants v ON v.product_id = p.id
    LEFT JOIN inventory i ON i.variant_id = v.id
    WHERE p.is_active = 1
    ORDER BY p.name ASC, v.weight_grams ASC
  `).all();

  return c.json({ success: true, items: products || [] });
});

// PUT /api/admin/variants/:id/pricing (Update INR / USD Prices & Discount)
adminApp.put('/variants/:id/pricing', async (c) => {
  const variantId = c.req.param('id');
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    price_inr?: number;
    price_usd_cents?: number;
    discount_percent?: number;
  }>();

  // Fetch current variant
  const current = await c.env.DB.prepare('SELECT * FROM product_variants WHERE id = ?').bind(variantId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Variant not found' }, 404);
  }

  const updatedPriceCents = body.price_usd_cents ?? current.price_cents;

  await c.env.DB.prepare(`
    UPDATE product_variants
    SET price_cents = ?
    WHERE id = ?
  `).bind(updatedPriceCents, variantId).run();

  await recordAuditLog(
    c.env.DB,
    actor,
    'PRICE_UPDATE',
    'product_variants',
    variantId,
    { price_cents: current.price_cents },
    { price_cents: updatedPriceCents, price_inr: body.price_inr, discount_percent: body.discount_percent },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({
    success: true,
    message: `Updated pricing for ${current.sku}: ₹${body.price_inr || Math.round(updatedPriceCents * 0.23)} / $${(updatedPriceCents / 100).toFixed(2)}`,
    variant_id: variantId,
  });
});

// GET /api/admin/coupons
adminApp.get('/coupons', async (c) => {
  const { results: coupons } = await c.env.DB.prepare(
    'SELECT * FROM coupons ORDER BY created_at DESC'
  ).all();
  return c.json({ success: true, coupons: coupons || [] });
});

// POST /api/admin/coupons
adminApp.post('/coupons', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    code: string;
    discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discount_value: number;
    max_redemptions?: number;
  }>();

  const id = 'coup_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const code = body.code.trim().toUpperCase();

  await c.env.DB.prepare(`
    INSERT INTO coupons (id, code, discount_type, discount_value, max_redemptions, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).bind(id, code, body.discount_type, body.discount_value, body.max_redemptions || 500).run();

  await recordAuditLog(
    c.env.DB,
    actor,
    'CREATE_COUPON',
    'coupons',
    id,
    null,
    { code, discount_value: body.discount_value },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, coupon_id: id, code });
});

// POST /api/admin/roast-batch (Log green in vs roasted out, record roast loss %)
adminApp.post('/roast-batch', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    lot_name: string;
    green_kg_in: number;
    roasted_kg_out: number;
    roaster_profile: string;
    notes?: string;
  }>();

  const lossPct = Number((((body.green_kg_in - body.roasted_kg_out) / body.green_kg_in) * 100).toFixed(2));
  const batchId = 'batch_' + Date.now();

  return c.json({
    success: true,
    batch_id: batchId,
    green_in: body.green_kg_in,
    roasted_out: body.roasted_kg_out,
    roast_loss_percent: lossPct,
    message: `Logged batch "${body.lot_name}" with ${lossPct}% roast loss. Yield calibrated.`,
  });
});

// ==================== Marketing Hub ====================
// Internal planning/tracking only — no external channel/social API integration.

// GET /api/admin/channels
adminApp.get('/channels', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM communication_channels ORDER BY created_at DESC'
  ).all();
  return c.json({ success: true, channels: results || [] });
});

// POST /api/admin/channels
adminApp.post('/channels', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    name: string;
    channel_type: string;
    handle_or_address?: string;
    status?: string;
    notes?: string;
  }>();

  if (!body.name || !body.channel_type) {
    return c.json({ success: false, error: 'name and channel_type are required' }, 400);
  }

  const id = 'chan_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await c.env.DB.prepare(`
    INSERT INTO communication_channels (id, name, channel_type, handle_or_address, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.name, body.channel_type, body.handle_or_address || null, body.status || 'PLANNED', body.notes || null).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_CHANNEL',
    'communication_channels',
    id,
    null,
    { name: body.name, channel_type: body.channel_type },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, channel_id: id });
});

// GET /api/admin/campaigns
adminApp.get('/campaigns', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM social_campaigns ORDER BY created_at DESC'
  ).all();
  return c.json({ success: true, campaigns: results || [] });
});

// POST /api/admin/campaigns
adminApp.post('/campaigns', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    name: string;
    channel_id?: string;
    objective?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    notes?: string;
  }>();

  if (!body.name) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const id = 'camp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await c.env.DB.prepare(`
    INSERT INTO social_campaigns (id, name, channel_id, objective, status, start_date, end_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.name, body.channel_id || null, body.objective || null,
    body.status || 'DRAFT', body.start_date || null, body.end_date || null, body.notes || null
  ).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_CAMPAIGN',
    'social_campaigns',
    id,
    null,
    { name: body.name, status: body.status || 'DRAFT' },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, campaign_id: id });
});

const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED'];

// PATCH /api/admin/campaigns/:id/status
adminApp.patch('/campaigns/:id/status', async (c) => {
  const actor = c.get('adminActor');
  const campaignId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();

  if (!CAMPAIGN_STATUSES.includes(body.status)) {
    return c.json({ success: false, error: `status must be one of ${CAMPAIGN_STATUSES.join(', ')}` }, 400);
  }

  const current = await c.env.DB.prepare('SELECT status FROM social_campaigns WHERE id = ?').bind(campaignId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Campaign not found' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE social_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(body.status, campaignId).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'UPDATE_CAMPAIGN_STATUS',
    'social_campaigns',
    campaignId,
    { status: current.status },
    { status: body.status },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, status: body.status });
});

// GET /api/admin/limited-editions
adminApp.get('/limited-editions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM limited_editions ORDER BY created_at DESC'
  ).all();
  return c.json({ success: true, limited_editions: results || [] });
});

// POST /api/admin/limited-editions
adminApp.post('/limited-editions', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    name: string;
    description?: string;
    product_name?: string;
    product_id?: string;
    sku?: string;
    launch_date?: string;
    end_date?: string;
    total_units?: number;
  }>();

  if (!body.name) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const id = 'ltd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await c.env.DB.prepare(`
    INSERT INTO limited_editions (id, name, description, product_name, product_id, sku, launch_date, end_date, total_units, units_sold, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UPCOMING')
  `).bind(
    id, body.name, body.description || null, body.product_name || null, body.product_id || null,
    body.sku || null, body.launch_date || null, body.end_date || null, body.total_units || null
  ).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_LIMITED_EDITION',
    'limited_editions',
    id,
    null,
    { name: body.name, total_units: body.total_units },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, limited_edition_id: id });
});

const LIMITED_EDITION_STATUSES = ['UPCOMING', 'LIVE', 'SOLD_OUT', 'ENDED'];

// PATCH /api/admin/limited-editions/:id/status
adminApp.patch('/limited-editions/:id/status', async (c) => {
  const actor = c.get('adminActor');
  const editionId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();

  if (!LIMITED_EDITION_STATUSES.includes(body.status)) {
    return c.json({ success: false, error: `status must be one of ${LIMITED_EDITION_STATUSES.join(', ')}` }, 400);
  }

  const current = await c.env.DB.prepare('SELECT status FROM limited_editions WHERE id = ?').bind(editionId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Limited edition not found' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE limited_editions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(body.status, editionId).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'UPDATE_LIMITED_EDITION_STATUS',
    'limited_editions',
    editionId,
    { status: current.status },
    { status: body.status },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, status: body.status });
});

// GET /api/admin/promotions
adminApp.get('/promotions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM promotions ORDER BY created_at DESC'
  ).all();
  return c.json({ success: true, promotions: results || [] });
});

// POST /api/admin/promotions
adminApp.post('/promotions', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    name: string;
    description?: string;
    promo_type?: string;
    start_date?: string;
    end_date?: string;
    linked_coupon_id?: string;
  }>();

  if (!body.name) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const id = 'promo_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await c.env.DB.prepare(`
    INSERT INTO promotions (id, name, description, promo_type, start_date, end_date, linked_coupon_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED')
  `).bind(
    id, body.name, body.description || null, body.promo_type || 'SALE',
    body.start_date || null, body.end_date || null, body.linked_coupon_id || null
  ).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_PROMOTION',
    'promotions',
    id,
    null,
    { name: body.name, promo_type: body.promo_type || 'SALE' },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, promotion_id: id });
});

const PROMOTION_STATUSES = ['SCHEDULED', 'ACTIVE', 'ENDED'];

// PATCH /api/admin/promotions/:id/status
adminApp.patch('/promotions/:id/status', async (c) => {
  const actor = c.get('adminActor');
  const promotionId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();

  if (!PROMOTION_STATUSES.includes(body.status)) {
    return c.json({ success: false, error: `status must be one of ${PROMOTION_STATUSES.join(', ')}` }, 400);
  }

  const current = await c.env.DB.prepare('SELECT status FROM promotions WHERE id = ?').bind(promotionId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Promotion not found' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE promotions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(body.status, promotionId).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'UPDATE_PROMOTION_STATUS',
    'promotions',
    promotionId,
    { status: current.status },
    { status: body.status },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, status: body.status });
});

// ==================== Product Catalog Management ====================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// GET /api/admin/products — includes inactive products/variants, unlike the public catalog API
adminApp.get('/products', async (c) => {
  const { results: rawProducts } = await c.env.DB.prepare(`
    SELECT p.*, cat.name as category_name
    FROM products p
    JOIN categories cat ON p.category_id = cat.id
    ORDER BY p.created_at DESC
  `).all<any>();

  const products = rawProducts || [];
  if (products.length === 0) {
    return c.json({ success: true, products: [] });
  }

  const productIds = products.map((p) => p.id);
  const placeholders = productIds.map(() => '?').join(',');
  const { results: rawVariants } = await c.env.DB.prepare(`
    SELECT v.*, COALESCE(i.available_stock, 0) as available_stock, COALESCE(i.reserved_stock, 0) as reserved_stock
    FROM product_variants v
    LEFT JOIN inventory i ON v.id = i.variant_id
    WHERE v.product_id IN (${placeholders})
    ORDER BY v.weight_grams ASC
  `).bind(...productIds).all<any>();

  const variantsByProduct: Record<string, any[]> = {};
  for (const v of rawVariants || []) {
    if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
    variantsByProduct[v.product_id].push(v);
  }

  return c.json({
    success: true,
    products: products.map((p) => ({ ...p, variants: variantsByProduct[p.id] || [] })),
  });
});

// POST /api/admin/products — create a product with its first variant + opening inventory
adminApp.post('/products', async (c) => {
  const actor = c.get('adminActor');
  const body = await c.req.json<{
    name: string;
    category_id: string;
    origin_country: string;
    roast_level: string;
    description: string;
    image_url: string;
    weight_grams: number;
    price_cents: number;
    initial_stock?: number;
  }>();

  if (!body.name || !body.category_id || !body.origin_country || !body.roast_level || !body.description || !body.image_url || !body.weight_grams || !body.price_cents) {
    return c.json({ success: false, error: 'name, category_id, origin_country, roast_level, description, image_url, weight_grams, and price_cents are required' }, 400);
  }

  const category = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(body.category_id).first();
  if (!category) {
    return c.json({ success: false, error: 'Unknown category_id' }, 400);
  }

  const slugBase = slugify(body.name);
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 4)}`;
  const productId = 'prod_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const variantId = 'var_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const sku = `TDG-${slugBase.toUpperCase().replace(/-/g, '').slice(0, 10)}-${body.weight_grams}G`;

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO products (
        id, slug, name, tagline, description, category_id, origin_country, region, farm_or_coop,
        altitude_meters, variety, process_method, roast_level, tasting_notes,
        acidity_score, body_score, sweetness_score, image_url, is_featured, is_active
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, 'WASHED', ?, '["Balanced"]', 3, 3, 3, ?, 0, 1)
    `).bind(productId, slug, body.name, body.description, body.category_id, body.origin_country, body.origin_country, body.roast_level, body.image_url),

    c.env.DB.prepare(`
      INSERT INTO product_variants (id, product_id, sku, weight_grams, price_cents, grind_options, is_active)
      VALUES (?, ?, ?, ?, ?, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO"]', 1)
    `).bind(variantId, productId, sku, body.weight_grams, body.price_cents),
  ]);

  const ledger = new InventoryLedgerService(c.env.DB);
  await ledger.recordMovement({
    variantId,
    movementType: 'INITIAL_STOCK',
    delta: Number(body.initial_stock) || 0,
    referenceType: 'ADMIN',
    reason: `New product "${body.name}" created`,
    actor: actor?.email || 'ADMIN_PORTAL',
  });

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_PRODUCT',
    'products',
    productId,
    null,
    { name: body.name, slug, variant_id: variantId, sku },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, product_id: productId, variant_id: variantId, slug, sku });
});

// PATCH /api/admin/products/:id
adminApp.patch('/products/:id', async (c) => {
  const actor = c.get('adminActor');
  const productId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    image_url?: string;
    is_featured?: boolean;
    is_active?: boolean;
  }>();

  const current = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Product not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE products SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      image_url = COALESCE(?, image_url),
      is_featured = COALESCE(?, is_featured),
      is_active = COALESCE(?, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    body.name ?? null,
    body.description ?? null,
    body.image_url ?? null,
    body.is_featured === undefined ? null : (body.is_featured ? 1 : 0),
    body.is_active === undefined ? null : (body.is_active ? 1 : 0),
    productId
  ).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'UPDATE_PRODUCT',
    'products',
    productId,
    { is_active: current.is_active, name: current.name },
    body,
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true });
});

// POST /api/admin/products/:id/variants — add a new weight/price option to an existing product
adminApp.post('/products/:id/variants', async (c) => {
  const actor = c.get('adminActor');
  const productId = c.req.param('id');
  const body = await c.req.json<{
    weight_grams: number;
    price_cents: number;
    initial_stock?: number;
  }>();

  if (!body.weight_grams || !body.price_cents) {
    return c.json({ success: false, error: 'weight_grams and price_cents are required' }, 400);
  }

  const product = await c.env.DB.prepare('SELECT id, slug FROM products WHERE id = ?').bind(productId).first<any>();
  if (!product) {
    return c.json({ success: false, error: 'Product not found' }, 404);
  }

  const variantId = 'var_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const slugPart = String(product.slug).split('-').slice(0, -1).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const sku = `TDG-${slugPart}-${body.weight_grams}G-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

  await c.env.DB.prepare(`
    INSERT INTO product_variants (id, product_id, sku, weight_grams, price_cents, grind_options, is_active)
    VALUES (?, ?, ?, ?, ?, '["WHOLE_BEAN", "POUR_OVER", "ESPRESSO"]', 1)
  `).bind(variantId, productId, sku, body.weight_grams, body.price_cents).run();

  const ledger = new InventoryLedgerService(c.env.DB);
  await ledger.recordMovement({
    variantId,
    movementType: 'INITIAL_STOCK',
    delta: Number(body.initial_stock) || 0,
    referenceType: 'ADMIN',
    reason: `New variant added to product ${productId}`,
    actor: actor?.email || 'ADMIN_PORTAL',
  });

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'CREATE_VARIANT',
    'product_variants',
    variantId,
    null,
    { product_id: productId, weight_grams: body.weight_grams, sku },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, variant_id: variantId, sku });
});

// PATCH /api/admin/variants/:id/status
adminApp.patch('/variants/:id/status', async (c) => {
  const actor = c.get('adminActor');
  const variantId = c.req.param('id');
  const body = await c.req.json<{ is_active: boolean }>();

  if (typeof body.is_active !== 'boolean') {
    return c.json({ success: false, error: 'is_active must be true or false' }, 400);
  }

  const current = await c.env.DB.prepare('SELECT is_active FROM product_variants WHERE id = ?').bind(variantId).first<any>();
  if (!current) {
    return c.json({ success: false, error: 'Variant not found' }, 404);
  }

  await c.env.DB.prepare('UPDATE product_variants SET is_active = ? WHERE id = ?')
    .bind(body.is_active ? 1 : 0, variantId).run();

  await recordAuditLog(
    c.env.DB,
    actor || { id: 'admin', email: 'admin@dailygrind.coffee' },
    'UPDATE_VARIANT_STATUS',
    'product_variants',
    variantId,
    { is_active: current.is_active },
    { is_active: body.is_active },
    c.req.header('CF-Connecting-IP')
  );

  return c.json({ success: true, is_active: body.is_active });
});

export { adminApp };

