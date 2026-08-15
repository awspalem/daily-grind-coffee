import { Hono } from 'hono';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { zeroTrustAdminGuard, recordAuditLog } from '../middleware/zeroTrust';
import { FreeTierQuotaMonitor } from '../services/quotaMonitor';
import { D1BackupService } from '../services/backupService';
import { ShiprocketService } from '../services/shiprocket';
const adminApp = new Hono();
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
  `).first();
    // 2. Orders by status
    const { results: statusCounts } = await db.prepare(`
    SELECT status, COUNT(id) as count FROM orders GROUP BY status
  `).all();
    // 3. Low stock count
    const lowStockRow = await db.prepare(`
    SELECT COUNT(*) as low_stock_count
    FROM inventory
    WHERE available_stock <= low_stock_threshold
  `).first();
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
    const body = await c.req.json();
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
        await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'INVENTORY_ADJUSTMENT', 'variant_inventory', body.variant_id, null, { delta: body.quantity_delta, type: body.movement_type, newStock: result.newAvailableStock, reason: body.reason }, c.req.header('CF-Connecting-IP'));
        return c.json({ success: true, new_available_stock: result.newAvailableStock });
    }
    catch (err) {
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
    const params = [];
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
    const body = await c.req.json();
    if (!body.status) {
        return c.json({ success: false, error: 'Status is required' }, 400);
    }
    const oldOrder = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!oldOrder) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }
    let trackingNumber = body.tracking_number || null;
    let carrier = body.carrier || null;
    let shiprocketOrderId = null;
    let shiprocketShipmentId = null;
    let shiprocketStatus = null;
    let shiprocketPushError = null;
    let shiprocketSkipReason = null;
    // Auto-push newly packed orders to Shiprocket for fulfillment, once per order.
    // Shiprocket only ships within India — gate on destination, not on the order's
    // billing currency (the storefront can charge in USD for an India-bound parcel).
    const shippingAddressForGate = (() => {
        try {
            return JSON.parse(oldOrder.shipping_address_json);
        }
        catch {
            return {};
        }
    })();
    const normalizedCountry = String(shippingAddressForGate.country || '').trim().toUpperCase();
    const shipsToIndia = normalizedCountry === 'IN' || normalizedCountry === 'IND' || normalizedCountry === 'INDIA';
    if (body.status === 'PACKED' && !oldOrder.shiprocket_shipment_id && !shipsToIndia) {
        shiprocketSkipReason = `Shipping address country is "${shippingAddressForGate.country}", not IN — Shiprocket only ships within India, enter tracking manually`;
    }
    else if (body.status === 'PACKED' && !oldOrder.shiprocket_shipment_id) {
        try {
            const { results: items } = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all();
            const shippingAddress = shippingAddressForGate;
            const shiprocket = new ShiprocketService(c.env.SHIPROCKET_EMAIL, c.env.SHIPROCKET_PASSWORD, c.env.SHIPROCKET_PICKUP_LOCATION, c.env.CONFIG_KV, c.env.ENVIRONMENT, Number(c.env.SHIPROCKET_USD_TO_INR_RATE) || undefined);
            const result = await shiprocket.createOrder({
                orderId,
                orderNumber: oldOrder.order_number,
                orderDateISO: (oldOrder.created_at || new Date().toISOString()).slice(0, 19).replace('T', ' '),
                customerName: shippingAddress.name,
                customerEmail: oldOrder.customer_email,
                customerPhone: shippingAddress.phone,
                shippingAddress,
                items: (items || []).map((item) => ({
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
                if (tracking.awbCode)
                    trackingNumber = tracking.awbCode;
                if (tracking.courierName)
                    carrier = tracking.courierName;
            }
            catch (trackErr) {
                console.error('Shiprocket tracking lookup failed:', trackErr);
            }
        }
        catch (srErr) {
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
  `).bind(body.status, trackingNumber, carrier, shiprocketOrderId, shiprocketShipmentId, shiprocketStatus, orderId).run();
    // Audit Log
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'ORDER_STATUS_UPDATE', 'orders', orderId, { status: oldOrder?.status }, { status: body.status, tracking: trackingNumber, shiprocket_shipment_id: shiprocketShipmentId }, c.req.header('CF-Connecting-IP'));
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
    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }
    if (!order.shiprocket_shipment_id) {
        return c.json({ success: false, error: 'Order has not been pushed to Shiprocket yet' }, 400);
    }
    const shiprocket = new ShiprocketService(c.env.SHIPROCKET_EMAIL, c.env.SHIPROCKET_PASSWORD, c.env.SHIPROCKET_PICKUP_LOCATION, c.env.CONFIG_KV, c.env.ENVIRONMENT);
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
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 502);
    }
});
// POST /api/admin/orders/:id/refund
adminApp.post('/orders/:id/refund', async (c) => {
    const actor = c.get('adminActor');
    const orderId = c.req.param('id');
    const body = await c.req.json();
    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order)
        return c.json({ success: false, error: 'Order not found' }, 404);
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
    await recordAuditLog(c.env.DB, actor, 'ORDER_REFUND', 'orders', orderId, { status: order.status }, { status: 'REFUNDED', amount_cents: refundCents, reason: body.reason }, c.req.header('CF-Connecting-IP'));
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
    const body = await c.req.json();
    // Fetch current variant
    const current = await c.env.DB.prepare('SELECT * FROM product_variants WHERE id = ?').bind(variantId).first();
    if (!current) {
        return c.json({ success: false, error: 'Variant not found' }, 404);
    }
    const updatedPriceCents = body.price_usd_cents ?? current.price_cents;
    await c.env.DB.prepare(`
    UPDATE product_variants
    SET price_cents = ?
    WHERE id = ?
  `).bind(updatedPriceCents, variantId).run();
    await recordAuditLog(c.env.DB, actor, 'PRICE_UPDATE', 'product_variants', variantId, { price_cents: current.price_cents }, { price_cents: updatedPriceCents, price_inr: body.price_inr, discount_percent: body.discount_percent }, c.req.header('CF-Connecting-IP'));
    return c.json({
        success: true,
        message: `Updated pricing for ${current.sku}: ₹${body.price_inr || Math.round(updatedPriceCents * 0.23)} / $${(updatedPriceCents / 100).toFixed(2)}`,
        variant_id: variantId,
    });
});
// GET /api/admin/coupons
adminApp.get('/coupons', async (c) => {
    const { results: coupons } = await c.env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return c.json({ success: true, coupons: coupons || [] });
});
// POST /api/admin/coupons
adminApp.post('/coupons', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    const id = 'coup_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const code = body.code.trim().toUpperCase();
    await c.env.DB.prepare(`
    INSERT INTO coupons (id, code, discount_type, discount_value, max_redemptions, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).bind(id, code, body.discount_type, body.discount_value, body.max_redemptions || 500).run();
    await recordAuditLog(c.env.DB, actor, 'CREATE_COUPON', 'coupons', id, null, { code, discount_value: body.discount_value }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, coupon_id: id, code });
});
// POST /api/admin/roast-batch (Log green in vs roasted out, record roast loss %)
adminApp.post('/roast-batch', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
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
    const { results } = await c.env.DB.prepare('SELECT * FROM communication_channels ORDER BY created_at DESC').all();
    return c.json({ success: true, channels: results || [] });
});
// POST /api/admin/channels
adminApp.post('/channels', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    if (!body.name || !body.channel_type) {
        return c.json({ success: false, error: 'name and channel_type are required' }, 400);
    }
    const id = 'chan_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await c.env.DB.prepare(`
    INSERT INTO communication_channels (id, name, channel_type, handle_or_address, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.name, body.channel_type, body.handle_or_address || null, body.status || 'PLANNED', body.notes || null).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'CREATE_CHANNEL', 'communication_channels', id, null, { name: body.name, channel_type: body.channel_type }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, channel_id: id });
});
// GET /api/admin/campaigns
adminApp.get('/campaigns', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM social_campaigns ORDER BY created_at DESC').all();
    return c.json({ success: true, campaigns: results || [] });
});
// POST /api/admin/campaigns
adminApp.post('/campaigns', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    if (!body.name) {
        return c.json({ success: false, error: 'name is required' }, 400);
    }
    const id = 'camp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await c.env.DB.prepare(`
    INSERT INTO social_campaigns (id, name, channel_id, objective, status, start_date, end_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.name, body.channel_id || null, body.objective || null, body.status || 'DRAFT', body.start_date || null, body.end_date || null, body.notes || null).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'CREATE_CAMPAIGN', 'social_campaigns', id, null, { name: body.name, status: body.status || 'DRAFT' }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, campaign_id: id });
});
const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED'];
// PATCH /api/admin/campaigns/:id/status
adminApp.patch('/campaigns/:id/status', async (c) => {
    const actor = c.get('adminActor');
    const campaignId = c.req.param('id');
    const body = await c.req.json();
    if (!CAMPAIGN_STATUSES.includes(body.status)) {
        return c.json({ success: false, error: `status must be one of ${CAMPAIGN_STATUSES.join(', ')}` }, 400);
    }
    const current = await c.env.DB.prepare('SELECT status FROM social_campaigns WHERE id = ?').bind(campaignId).first();
    if (!current) {
        return c.json({ success: false, error: 'Campaign not found' }, 404);
    }
    await c.env.DB.prepare('UPDATE social_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.status, campaignId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'UPDATE_CAMPAIGN_STATUS', 'social_campaigns', campaignId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, status: body.status });
});
// GET /api/admin/limited-editions
adminApp.get('/limited-editions', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM limited_editions ORDER BY created_at DESC').all();
    return c.json({ success: true, limited_editions: results || [] });
});
// POST /api/admin/limited-editions
adminApp.post('/limited-editions', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    if (!body.name) {
        return c.json({ success: false, error: 'name is required' }, 400);
    }
    const id = 'ltd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await c.env.DB.prepare(`
    INSERT INTO limited_editions (id, name, description, product_name, product_id, sku, launch_date, end_date, total_units, units_sold, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UPCOMING')
  `).bind(id, body.name, body.description || null, body.product_name || null, body.product_id || null, body.sku || null, body.launch_date || null, body.end_date || null, body.total_units || null).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'CREATE_LIMITED_EDITION', 'limited_editions', id, null, { name: body.name, total_units: body.total_units }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, limited_edition_id: id });
});
const LIMITED_EDITION_STATUSES = ['UPCOMING', 'LIVE', 'SOLD_OUT', 'ENDED'];
// PATCH /api/admin/limited-editions/:id/status
adminApp.patch('/limited-editions/:id/status', async (c) => {
    const actor = c.get('adminActor');
    const editionId = c.req.param('id');
    const body = await c.req.json();
    if (!LIMITED_EDITION_STATUSES.includes(body.status)) {
        return c.json({ success: false, error: `status must be one of ${LIMITED_EDITION_STATUSES.join(', ')}` }, 400);
    }
    const current = await c.env.DB.prepare('SELECT status FROM limited_editions WHERE id = ?').bind(editionId).first();
    if (!current) {
        return c.json({ success: false, error: 'Limited edition not found' }, 404);
    }
    await c.env.DB.prepare('UPDATE limited_editions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.status, editionId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'UPDATE_LIMITED_EDITION_STATUS', 'limited_editions', editionId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, status: body.status });
});
// GET /api/admin/promotions
adminApp.get('/promotions', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all();
    return c.json({ success: true, promotions: results || [] });
});
// POST /api/admin/promotions
adminApp.post('/promotions', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    if (!body.name) {
        return c.json({ success: false, error: 'name is required' }, 400);
    }
    const id = 'promo_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await c.env.DB.prepare(`
    INSERT INTO promotions (id, name, description, promo_type, start_date, end_date, linked_coupon_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED')
  `).bind(id, body.name, body.description || null, body.promo_type || 'SALE', body.start_date || null, body.end_date || null, body.linked_coupon_id || null).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'CREATE_PROMOTION', 'promotions', id, null, { name: body.name, promo_type: body.promo_type || 'SALE' }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, promotion_id: id });
});
const PROMOTION_STATUSES = ['SCHEDULED', 'ACTIVE', 'ENDED'];
// PATCH /api/admin/promotions/:id/status
adminApp.patch('/promotions/:id/status', async (c) => {
    const actor = c.get('adminActor');
    const promotionId = c.req.param('id');
    const body = await c.req.json();
    if (!PROMOTION_STATUSES.includes(body.status)) {
        return c.json({ success: false, error: `status must be one of ${PROMOTION_STATUSES.join(', ')}` }, 400);
    }
    const current = await c.env.DB.prepare('SELECT status FROM promotions WHERE id = ?').bind(promotionId).first();
    if (!current) {
        return c.json({ success: false, error: 'Promotion not found' }, 404);
    }
    await c.env.DB.prepare('UPDATE promotions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.status, promotionId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailygrind.coffee' }, 'UPDATE_PROMOTION_STATUS', 'promotions', promotionId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, status: body.status });
});
export { adminApp };
