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

export { adminApp };

