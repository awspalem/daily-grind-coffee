import { Hono } from 'hono';
const analyticsApp = new Hono();
// POST /api/analytics/event
analyticsApp.post('/event', async (c) => {
    const body = await c.req.json();
    if (!body.event_name) {
        return c.json({ success: false, error: 'event_name is required' }, 400);
    }
    const id = 'evt_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
    INSERT INTO analytics_events (id, event_name, session_id, product_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(id, body.event_name, body.session_id || null, body.product_id || null, body.metadata ? JSON.stringify(body.metadata) : null).run();
    return c.json({ success: true, event_id: id });
});
// GET /api/analytics/funnel (Admin Telemetry)
analyticsApp.get('/funnel', async (c) => {
    const { results } = await c.env.DB.prepare(`
    SELECT event_name, COUNT(id) as count
    FROM analytics_events
    GROUP BY event_name
  `).all();
    const counts = {
        product_view: 0,
        add_to_cart: 0,
        checkout_started: 0,
        purchase: 0,
    };
    for (const r of results || []) {
        counts[r.event_name] = Number(r.count);
    }
    const views = counts.product_view || 1;
    const cartConversion = Math.round((counts.add_to_cart / views) * 1000) / 10;
    const checkoutConversion = Math.round((counts.checkout_started / views) * 1000) / 10;
    const purchaseConversion = Math.round((counts.purchase / views) * 1000) / 10;
    return c.json({
        success: true,
        funnel: {
            views: counts.product_view,
            cart_adds: counts.add_to_cart,
            checkouts: counts.checkout_started,
            purchases: counts.purchase,
            conversion_rates: {
                view_to_cart_pct: cartConversion,
                view_to_checkout_pct: checkoutConversion,
                overall_conversion_pct: purchaseConversion,
            },
        },
    });
});
export { analyticsApp };
