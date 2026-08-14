import { Hono } from 'hono';
const customerApp = new Hono();
// GET /api/customer/me
customerApp.get('/me', async (c) => {
    const email = c.req.header('X-Customer-Email') || c.req.query('email');
    if (!email) {
        return c.json({ success: false, error: 'Customer email required' }, 400);
    }
    let customer = await c.env.DB.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first();
    if (!customer) {
        const custId = 'cust_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        await c.env.DB.prepare(`
      INSERT INTO customers (id, email, loyalty_points) VALUES (?, ?, 50)
    `).bind(custId, email).run();
        customer = {
            id: custId,
            email,
            loyalty_points: 50,
            created_at: new Date().toISOString(),
        };
    }
    // Fetch past orders
    const { results: orders } = await c.env.DB.prepare(`
    SELECT id, order_number, status, total_cents, tracking_number, created_at
    FROM orders
    WHERE customer_email = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(email).all();
    // Fetch saved addresses
    const { results: addresses } = await c.env.DB.prepare(`
    SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC
  `).bind(customer.id).all();
    return c.json({
        success: true,
        customer: {
            id: customer.id,
            email: customer.email,
            full_name: customer.full_name,
            loyalty_points: Number(customer.loyalty_points || 0),
            addresses: addresses || [],
            recent_orders: orders || [],
        },
    });
});
// POST /api/customer/address
customerApp.post('/address', async (c) => {
    const body = await c.req.json();
    if (!body.customer_email || !body.address) {
        return c.json({ success: false, error: 'Customer email and address are required' }, 400);
    }
    let customer = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(body.customer_email).first();
    if (!customer) {
        const custId = 'cust_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        await c.env.DB.prepare('INSERT INTO customers (id, email) VALUES (?, ?)').bind(custId, body.customer_email).run();
        customer = { id: custId };
    }
    const addrId = 'addr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
    INSERT INTO customer_addresses (
      id, customer_id, is_default, name, line1, line2, city, state, postal_code, country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(addrId, customer.id, body.is_default ? 1 : 0, body.address.name, body.address.line1, body.address.line2 || null, body.address.city, body.address.state, body.address.postal_code, body.address.country || 'US').run();
    return c.json({ success: true, address_id: addrId });
});
export { customerApp };
