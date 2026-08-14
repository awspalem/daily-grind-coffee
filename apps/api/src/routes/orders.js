import { Hono } from 'hono';
const ordersApp = new Hono();
// GET /api/orders/:identifier (orderNumber or orderId)
ordersApp.get('/:identifier', async (c) => {
    const identifier = c.req.param('identifier');
    const rawOrder = await c.env.DB.prepare(`
    SELECT * FROM orders 
    WHERE id = ? OR order_number = ? OR stripe_session_id = ?
    LIMIT 1
  `).bind(identifier, identifier, identifier).first();
    if (!rawOrder) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }
    const { results: rawItems } = await c.env.DB.prepare(`
    SELECT * FROM order_items WHERE order_id = ?
  `).bind(rawOrder.id).all();
    const items = (rawItems || []).map((it) => ({
        id: it.id,
        order_id: it.order_id,
        variant_id: it.variant_id,
        product_name: it.product_name,
        weight_grams: Number(it.weight_grams),
        grind_type: it.grind_type,
        unit_price_cents: Number(it.unit_price_cents),
        quantity: Number(it.quantity),
        total_price_cents: Number(it.total_price_cents),
    }));
    const order = {
        id: rawOrder.id,
        order_number: rawOrder.order_number,
        customer_id: rawOrder.customer_id || undefined,
        customer_email: rawOrder.customer_email,
        status: rawOrder.status,
        subtotal_cents: Number(rawOrder.subtotal_cents),
        shipping_cents: Number(rawOrder.shipping_cents),
        tax_cents: Number(rawOrder.tax_cents),
        discount_cents: Number(rawOrder.discount_cents),
        total_cents: Number(rawOrder.total_cents),
        currency: rawOrder.currency,
        shipping_address: typeof rawOrder.shipping_address_json === 'string'
            ? JSON.parse(rawOrder.shipping_address_json)
            : rawOrder.shipping_address_json,
        stripe_session_id: rawOrder.stripe_session_id || undefined,
        stripe_payment_intent_id: rawOrder.stripe_payment_intent_id || undefined,
        tracking_number: rawOrder.tracking_number || undefined,
        carrier: rawOrder.carrier || undefined,
        items,
        notes: rawOrder.notes || undefined,
        created_at: rawOrder.created_at,
        updated_at: rawOrder.updated_at,
    };
    return c.json({ success: true, order });
});
export { ordersApp };
