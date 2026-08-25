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
        await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'INVENTORY_ADJUSTMENT', 'variant_inventory', body.variant_id, null, { delta: body.quantity_delta, type: body.movement_type, newStock: result.newAvailableStock, reason: body.reason }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'ORDER_STATUS_UPDATE', 'orders', orderId, { status: oldOrder?.status }, { status: body.status, tracking: trackingNumber, shiprocket_shipment_id: shiprocketShipmentId }, c.req.header('CF-Connecting-IP'));
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
    // Normalize to what cart.ts / checkout.ts actually check for (coupons.discount_type = 'PERCENT'
    // or 'FIXED') — this previously stored whatever the caller sent verbatim, including
    // 'PERCENTAGE', which the discount-application code doesn't recognize and silently falls
    // through to treating the value as a flat cents amount instead of a percentage.
    const discountType = body.discount_type.startsWith('PERCENT') ? 'PERCENT' : 'FIXED';
    await c.env.DB.prepare(`
    INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).bind(id, code, discountType, body.discount_value, body.max_redemptions || 500).run();
    await recordAuditLog(c.env.DB, actor, 'CREATE_COUPON', 'coupons', id, null, { code, discount_value: body.discount_value }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, coupon_id: id, code });
});
// GET /api/admin/roast-batches
adminApp.get('/roast-batches', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM roast_batches ORDER BY created_at DESC LIMIT 100').all();
    return c.json({ success: true, batches: results || [] });
});
// POST /api/admin/roast-batch (Log green in vs roasted out, record roast loss %)
adminApp.post('/roast-batch', async (c) => {
    const actor = c.get('adminActor');
    const body = await c.req.json();
    const lossPct = Number((((body.green_kg_in - body.roasted_kg_out) / body.green_kg_in) * 100).toFixed(2));
    const batchId = 'batch_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await c.env.DB.prepare(`
    INSERT INTO roast_batches (id, lot_name, green_kg_in, roasted_kg_out, roast_loss_percent, roaster_profile, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(batchId, body.lot_name, body.green_kg_in, body.roasted_kg_out, lossPct, body.roaster_profile || null, body.notes || null).run();
    await recordAuditLog(c.env.DB, actor, 'LOG_ROAST_BATCH', 'roast_batches', batchId, null, { lot_name: body.lot_name, roast_loss_percent: lossPct }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_CHANNEL', 'communication_channels', id, null, { name: body.name, channel_type: body.channel_type }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_CAMPAIGN', 'social_campaigns', id, null, { name: body.name, status: body.status || 'DRAFT' }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'UPDATE_CAMPAIGN_STATUS', 'social_campaigns', campaignId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_LIMITED_EDITION', 'limited_editions', id, null, { name: body.name, total_units: body.total_units }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'UPDATE_LIMITED_EDITION_STATUS', 'limited_editions', editionId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_PROMOTION', 'promotions', id, null, { name: body.name, promo_type: body.promo_type || 'SALE' }, c.req.header('CF-Connecting-IP'));
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'UPDATE_PROMOTION_STATUS', 'promotions', promotionId, { status: current.status }, { status: body.status }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, status: body.status });
});
// ==================== Product Catalog Management ====================
function slugify(name) {
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
  `).all();
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
  `).bind(...productIds).all();
    const variantsByProduct = {};
    for (const v of rawVariants || []) {
        if (!variantsByProduct[v.product_id])
            variantsByProduct[v.product_id] = [];
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
    const body = await c.req.json();
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_PRODUCT', 'products', productId, null, { name: body.name, slug, variant_id: variantId, sku }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, product_id: productId, variant_id: variantId, slug, sku });
});
// PATCH /api/admin/products/:id
adminApp.patch('/products/:id', async (c) => {
    const actor = c.get('adminActor');
    const productId = c.req.param('id');
    const body = await c.req.json();
    const current = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
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
  `).bind(body.name ?? null, body.description ?? null, body.image_url ?? null, body.is_featured === undefined ? null : (body.is_featured ? 1 : 0), body.is_active === undefined ? null : (body.is_active ? 1 : 0), productId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'UPDATE_PRODUCT', 'products', productId, { is_active: current.is_active, name: current.name }, body, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true });
});
// POST /api/admin/products/:id/variants — add a new weight/price option to an existing product
adminApp.post('/products/:id/variants', async (c) => {
    const actor = c.get('adminActor');
    const productId = c.req.param('id');
    const body = await c.req.json();
    if (!body.weight_grams || !body.price_cents) {
        return c.json({ success: false, error: 'weight_grams and price_cents are required' }, 400);
    }
    const product = await c.env.DB.prepare('SELECT id, slug FROM products WHERE id = ?').bind(productId).first();
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
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'CREATE_VARIANT', 'product_variants', variantId, null, { product_id: productId, weight_grams: body.weight_grams, sku }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, variant_id: variantId, sku });
});
// PATCH /api/admin/variants/:id/status
adminApp.patch('/variants/:id/status', async (c) => {
    const actor = c.get('adminActor');
    const variantId = c.req.param('id');
    const body = await c.req.json();
    if (typeof body.is_active !== 'boolean') {
        return c.json({ success: false, error: 'is_active must be true or false' }, 400);
    }
    const current = await c.env.DB.prepare('SELECT is_active FROM product_variants WHERE id = ?').bind(variantId).first();
    if (!current) {
        return c.json({ success: false, error: 'Variant not found' }, 404);
    }
    await c.env.DB.prepare('UPDATE product_variants SET is_active = ? WHERE id = ?')
        .bind(body.is_active ? 1 : 0, variantId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'UPDATE_VARIANT_STATUS', 'product_variants', variantId, { is_active: current.is_active }, { is_active: body.is_active }, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true, is_active: body.is_active });
});
// ==================== Subscriptions (Subscribe & Save) ====================
// The renewal cron (index.ts scheduled()) can silently mark a subscription PAST_DUE — declined
// card, sold-out product, no saved payment method — with no way for the roaster to see or act
// on it until now.
adminApp.get('/subscriptions', async (c) => {
    const { results } = await c.env.DB.prepare(`
    SELECT id, customer_email, product_name, grind_type, frequency, quantity, status,
           next_renewal_date, stripe_customer_id, stripe_payment_method_id, created_at
    FROM subscriptions
    ORDER BY CASE status WHEN 'PAST_DUE' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, next_renewal_date ASC
  `).all();
    return c.json({ success: true, subscriptions: results || [] });
});
// ==================== Reviews Moderation ====================
adminApp.get('/reviews', async (c) => {
    const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.rating, r.customer_name, r.comment, r.is_verified_purchase, r.created_at,
           p.name as product_name
    FROM reviews r
    JOIN products p ON r.product_id = p.id
    ORDER BY r.created_at DESC
    LIMIT 200
  `).all();
    return c.json({ success: true, reviews: results || [] });
});
adminApp.delete('/reviews/:id', async (c) => {
    const actor = c.get('adminActor');
    const reviewId = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(reviewId).first();
    if (!existing) {
        return c.json({ success: false, error: 'Review not found' }, 404);
    }
    await c.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId).run();
    await recordAuditLog(c.env.DB, actor || { id: 'admin', email: 'admin@dailyroast.in' }, 'DELETE_REVIEW', 'reviews', reviewId, existing, null, c.req.header('CF-Connecting-IP'));
    return c.json({ success: true });
});
export { adminApp };
