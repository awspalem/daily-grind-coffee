import { Hono } from 'hono';
import { turnstileValidator } from '../middleware/turnstile';
import { ResendEmailService } from '../services/resend';
import { generateLoginCodeEmail } from '../services/emailTemplate';
import { lookupCustomerSession, SESSION_EXPIRED, UNAUTHENTICATED, } from '../middleware/customerAuth';
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_EMAIL_MAX = 5;
const LOGIN_FLOOR_MS = 250;
const SUPPORTED_COUNTRIES = new Set(['IN']);
const INDIA_STATES = new Set([
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]);
const INDIAN_PIN_REGEX = /^[1-9][0-9]{5}$/;
function validateAddress(address) {
    if (!address || typeof address !== 'object')
        return { ok: false, error: 'Address is required' };
    const required = ['name', 'line1', 'city', 'state', 'postal_code', 'country'];
    for (const field of required) {
        const value = address[field];
        if (typeof value !== 'string' || !value.trim())
            return { ok: false, error: `${field} is required` };
    }
    const country = address.country.trim().toUpperCase();
    if (!SUPPORTED_COUNTRIES.has(country)) {
        return { ok: false, error: 'Only India (IN) shipping is supported' };
    }
    const state = address.state.trim();
    if (country === 'IN' && !INDIA_STATES.has(state)) {
        return { ok: false, error: 'Unknown Indian state' };
    }
    const postal = address.postal_code.trim();
    if (country === 'IN' && !INDIAN_PIN_REGEX.test(postal)) {
        return { ok: false, error: 'Invalid Indian PIN code (expected 6 digits, not starting with 0)' };
    }
    return {
        ok: true,
        value: {
            ...address,
            name: address.name.trim(),
            line1: address.line1.trim(),
            line2: address.line2?.trim() || undefined,
            city: address.city.trim(),
            state,
            postal_code: postal,
            country,
        },
    };
}
async function withEnumerationFloor(start, work) {
    const result = await work();
    const elapsed = Date.now() - start;
    if (elapsed < LOGIN_FLOOR_MS) {
        await new Promise((resolve) => setTimeout(resolve, LOGIN_FLOOR_MS - elapsed));
    }
    return result;
}
async function checkEmailLoginRate(db, email) {
    // Compare against SQLite's CURRENT_TIMESTAMP format ('YYYY-MM-DD HH:MM:SS'), not ISO-8601 —
    // the customer_login_codes.created_at column is a DATETIME and SQLite compares them as
    // strings, so a T-separator vs a space-separator would silently include nothing in the
    // window and the cap would never bite.
    const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM customer_login_codes
        WHERE email = ? AND created_at > datetime('now', ?)`)
        .bind(email, `-${LOGIN_EMAIL_WINDOW_MS / 1000} seconds`)
        .first();
    return Number(row?.n || 0) < LOGIN_EMAIL_MAX;
}
function generateSessionToken() {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}
function clientIpFromContext(c) {
    return c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}
async function writeAudit(c, action, customerId, email) {
    await c.env.DB.prepare(`INSERT INTO audit_log (id, actor_id, actor_email, action, entity_type, entity_id, ip_address)
     VALUES (?, ?, ?, ?, 'customer', ?, ?)`).bind('al_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), customerId, email, action, customerId, clientIpFromContext(c)).run().catch(() => {
        // best-effort: an audit failure must not break the auth flow
    });
}
const customerApp = new Hono();
async function sha256Hex(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
// POST /api/customer/login/request — emails a one-time 6-digit code, valid for 10 minutes.
// Turnstile-protected: without it, this endpoint would let anyone spam arbitrary email
// addresses with codes. A per-email cap (5/15min) sits on top so a single inbox cannot be
// flooded from many IPs. The 250ms response floor absorbs the time difference between
// "email exists, do the full write" and "email does not exist, skip it".
customerApp.post('/login/request', turnstileValidator, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        return c.json({ success: false, error: 'A valid email is required' }, 400);
    }
    const start = Date.now();
    const { rateLimited } = await withEnumerationFloor(start, async () => {
        if (!(await checkEmailLoginRate(c.env.DB, email))) {
            return { rateLimited: true };
        }
        const code = generateSixDigitCode();
        const codeHash = await sha256Hex(code);
        const id = 'lgc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString();
        await c.env.DB.prepare(`
      INSERT INTO customer_login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)
    `).bind(id, email, codeHash, expiresAt).run();
        const emailService = new ResendEmailService(c.env.RESEND_API_KEY, c.env.RESEND_FROM_EMAIL);
        const emailData = generateLoginCodeEmail({ email, code });
        const result = await emailService.send(emailData.to, emailData.subject, emailData.html);
        if (!result.success) {
            console.error(`Login code email failed for ${email}:`, result.error);
        }
        return { rateLimited: false };
    });
    if (rateLimited) {
        c.header('Retry-After', String(Math.ceil(LOGIN_EMAIL_WINDOW_MS / 1000)));
        return c.json({ success: true, message: 'If that email is valid, a login code has been sent.' });
    }
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
    // Session-fixation protection: a successful login must replace every active session for this
    // customer. Any token an attacker may have planted (e.g. by sharing a device) stops working
    // the moment the real owner signs in.
    await c.env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(customer.id).run();
    const sessionToken = generateSessionToken();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await c.env.DB.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)').bind(sessionToken, customer.id, sessionExpiresAt).run();
    await writeAudit(c, 'LOGIN', customer.id, email);
    return c.json({ success: true, session_token: sessionToken, email });
});
// POST /api/customer/logout
customerApp.post('/logout', async (c) => {
    const token = c.req.header('X-Customer-Session');
    if (token) {
        const session = await c.env.DB
            .prepare('SELECT customer_id FROM customer_sessions WHERE token = ?')
            .bind(token)
            .first();
        const result = await c.env.DB.prepare('DELETE FROM customer_sessions WHERE token = ?').bind(token).run();
        if (result.meta?.changes && session) {
            await writeAudit(c, 'LOGOUT', session.customer_id, null);
        }
    }
    return c.json({ success: true });
});
// GET /api/customer/me — requires a verified session (see /login/request + /login/verify above).
// Previously trusted a bare X-Customer-Email header with no proof of ownership — anyone could
// read anyone else's order history and saved addresses just by typing their email.
customerApp.get('/me', async (c) => {
    const lookup = await lookupCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (lookup.kind === 'expired')
        return c.json(SESSION_EXPIRED, 401);
    if (lookup.kind !== 'ok')
        return c.json(UNAUTHENTICATED, 401);
    const session = lookup.session;
    const customer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(session.customerId).first();
    if (!customer) {
        return c.json(SESSION_EXPIRED, 401);
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
    const lookup = await lookupCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (lookup.kind === 'expired')
        return c.json(SESSION_EXPIRED, 401);
    if (lookup.kind !== 'ok')
        return c.json(UNAUTHENTICATED, 401);
    const session = lookup.session;
    const body = await c.req.json();
    const validated = validateAddress(body.address);
    if (!validated.ok)
        return c.json({ success: false, error: validated.error }, 400);
    const address = validated.value;
    const addrId = 'addr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
    INSERT INTO customer_addresses (
      id, customer_id, is_default, name, line1, line2, city, state, postal_code, country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(addrId, session.customerId, body.is_default ? 1 : 0, address.name, address.line1, address.line2 || null, address.city, address.state, address.postal_code, address.country).run();
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
