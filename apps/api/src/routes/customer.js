import { Hono } from 'hono';
import { turnstileValidator } from '../middleware/turnstile';
import { ResendEmailService } from '../services/resend';
import { generateLoginCodeEmail } from '../services/emailTemplate';
const customerApp = new Hono();
async function sha256Hex(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
async function resolveSession(db, token) {
    if (!token)
        return null;
    const session = await db.prepare('SELECT customer_id FROM customer_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP').bind(token).first();
    if (!session)
        return null;
    const customer = await db.prepare('SELECT id, email FROM customers WHERE id = ?').bind(session.customer_id).first();
    if (!customer)
        return null;
    return { customerId: customer.id, email: customer.email };
}
// POST /api/customer/login/request — emails a one-time 6-digit code, valid for 10 minutes.
// Turnstile-protected: without it, this endpoint would let anyone spam arbitrary email
// addresses with codes.
customerApp.post('/login/request', turnstileValidator, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        return c.json({ success: false, error: 'A valid email is required' }, 400);
    }
    const code = generateSixDigitCode();
    const codeHash = await sha256Hex(code);
    const id = 'lgc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await c.env.DB.prepare(`
    INSERT INTO customer_login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)
  `).bind(id, email, codeHash, expiresAt).run();
    const emailService = new ResendEmailService(c.env.RESEND_API_KEY, c.env.RESEND_FROM_EMAIL);
    const emailData = generateLoginCodeEmail({ email, code });
    const result = await emailService.send(emailData.to, emailData.subject, emailData.html);
    if (!result.success) {
        console.error(`Login code email failed for ${email}:`, result.error);
    }
    // Always success regardless of email-send outcome — don't reveal delivery details to the
    // caller, and RESEND_API_KEY may simply not be configured yet in this deploy.
    return c.json({ success: true, message: 'If that email is valid, a login code has been sent.' });
});
// POST /api/customer/login/verify — exchanges a valid code for a session token.
customerApp.post('/login/verify', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const code = (body.code || '').trim();
    if (!email || !code) {
        return c.json({ success: false, error: 'Email and code are required' }, 400);
    }
    const codeHash = await sha256Hex(code);
    const loginCode = await c.env.DB.prepare(`
    SELECT id FROM customer_login_codes
    WHERE email = ? AND code_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC LIMIT 1
  `).bind(email, codeHash).first();
    if (!loginCode) {
        return c.json({ success: false, error: 'Invalid or expired code' }, 400);
    }
    await c.env.DB.prepare('UPDATE customer_login_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(loginCode.id).run();
    let customer = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first();
    if (!customer) {
        const custId = 'cust_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        await c.env.DB.prepare('INSERT INTO customers (id, email, loyalty_points) VALUES (?, ?, 50)').bind(custId, email).run();
        customer = { id: custId };
    }
    const sessionToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await c.env.DB.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)').bind(sessionToken, customer.id, sessionExpiresAt).run();
    return c.json({ success: true, session_token: sessionToken, email });
});
// POST /api/customer/logout
customerApp.post('/logout', async (c) => {
    const token = c.req.header('X-Customer-Session');
    if (token) {
        await c.env.DB.prepare('DELETE FROM customer_sessions WHERE token = ?').bind(token).run();
    }
    return c.json({ success: true });
});
// GET /api/customer/me — requires a verified session (see /login/request + /login/verify above).
// Previously trusted a bare X-Customer-Email header with no proof of ownership — anyone could
// read anyone else's order history and saved addresses just by typing their email.
customerApp.get('/me', async (c) => {
    const session = await resolveSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session) {
        return c.json({ success: false, error: 'Not authenticated' }, 401);
    }
    const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(session.customerId).first();
    if (!customer) {
        return c.json({ success: false, error: 'Not authenticated' }, 401);
    }
    const { results: orders } = await c.env.DB.prepare(`
    SELECT id, order_number, status, total_cents, tracking_number, created_at
    FROM orders
    WHERE customer_email = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(customer.email).all();
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
// POST /api/customer/address — requires a verified session; address is now always attached to
// the authenticated customer rather than whatever email the caller claimed in the body.
customerApp.post('/address', async (c) => {
    const session = await resolveSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (!session) {
        return c.json({ success: false, error: 'Not authenticated' }, 401);
    }
    const body = await c.req.json();
    if (!body.address) {
        return c.json({ success: false, error: 'Address is required' }, 400);
    }
    const addrId = 'addr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
    INSERT INTO customer_addresses (
      id, customer_id, is_default, name, line1, line2, city, state, postal_code, country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(addrId, session.customerId, body.is_default ? 1 : 0, body.address.name, body.address.line1, body.address.line2 || null, body.address.city, body.address.state, body.address.postal_code, body.address.country || 'US').run();
    return c.json({ success: true, address_id: addrId });
});
// POST /api/customer/newsletter/subscribe — storefront footer email capture.
customerApp.post('/newsletter/subscribe', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        return c.json({ success: false, error: 'A valid email is required' }, 400);
    }
    const id = 'nws_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
    INSERT INTO newsletter_subscribers (id, email, source, status)
    VALUES (?, ?, 'storefront_footer', 'SUBSCRIBED')
    ON CONFLICT(email) DO UPDATE SET status = 'SUBSCRIBED', updated_at = CURRENT_TIMESTAMP
  `).bind(id, email).run();
    return c.json({ success: true });
});
export { customerApp };
