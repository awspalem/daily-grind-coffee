import { Hono } from 'hono';
import { getOrCreateCart } from './cart';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { StripeService } from '../services/stripe';
import { turnstileValidator } from '../middleware/turnstile';
const checkoutApp = new Hono();
// POST /api/checkout (Protected by Turnstile)
checkoutApp.post('/', turnstileValidator, async (c) => {
    const sessionToken = c.req.header('X-Session-Token');
    const body = await c.req.json();
    const token = sessionToken || body.session_token;
    if (!token) {
        return c.json({ success: false, error: 'Session token required' }, 400);
    }
    if (!body.customer_email || !body.shipping_address) {
        return c.json({ success: false, error: 'Customer email and shipping address are required' }, 400);
    }
    // Fetch current cart state
    const cart = await getOrCreateCart(c.env.DB, token);
    if (!cart.items || cart.items.length === 0) {
        return c.json({ success: false, error: 'Cart is empty' }, 400);
    }
    const ledger = new InventoryLedgerService(c.env.DB);
    // 1. Verify stock availability and reserve items
    try {
        for (const item of cart.items) {
            await ledger.recordMovement({
                variantId: item.variant_id,
                movementType: 'PURCHASE_RESERVE',
                delta: -item.quantity,
                referenceType: 'CART',
                referenceId: cart.id,
                reason: 'Checkout stock reservation hold',
                actor: 'CHECKOUT_SERVICE',
            });
        }
    }
    catch (err) {
        return c.json({ success: false, error: err.message || 'Stock reservation error' }, 409);
    }
    // 2. Create Order in D1
    const orderId = 'ord_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const orderNumber = 'TDG-' + Math.floor(100000 + Math.random() * 900000);
    const shippingCents = cart.subtotal_cents >= 5000 ? 0 : 500; // Free shipping over $50
    const taxCents = Math.round(cart.total_cents * 0.08); // 8% estimated sales tax
    const totalCents = cart.total_cents + shippingCents + taxCents;
    const orderStatements = [
        c.env.DB.prepare(`
      INSERT INTO orders (
        id, order_number, customer_email, status, subtotal_cents,
        shipping_cents, tax_cents, discount_cents, total_cents,
        currency, shipping_address_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, 'usd', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(orderId, orderNumber, body.customer_email, cart.subtotal_cents, shippingCents, taxCents, cart.discount_cents, totalCents, JSON.stringify(body.shipping_address)),
    ];
    for (const item of cart.items) {
        const orderItemId = 'oi_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        orderStatements.push(c.env.DB.prepare(`
        INSERT INTO order_items (
          id, order_id, variant_id, product_name, weight_grams, grind_type, unit_price_cents, quantity, total_price_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(orderItemId, orderId, item.variant_id, item.product_name, item.weight_grams, item.grind_type, item.price_cents, item.quantity, item.line_total_cents));
    }
    await c.env.DB.batch(orderStatements);
    // 3. Create Stripe Checkout Session
    const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);
    const storefrontUrl = c.env.STOREFRONT_URL || 'http://localhost:5173';
    try {
        const session = await stripe.createCheckoutSession({
            orderId,
            orderNumber,
            customerEmail: body.customer_email,
            items: cart.items.map((it) => ({
                name: `${it.product_name} (${it.weight_grams}g, ${it.grind_type})`,
                unitPriceCents: it.price_cents,
                quantity: it.quantity,
            })),
            shippingCents,
            successUrl: `${storefrontUrl}/order-confirmation?order_id=${orderId}&order_number=${orderNumber}`,
            cancelUrl: `${storefrontUrl}/cart?cancelled=true`,
            currency: c.env.CURRENCY || 'usd',
        });
        // Update order with Stripe session ID
        await c.env.DB.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').bind(session.id, orderId).run();
        return c.json({
            success: true,
            order_id: orderId,
            order_number: orderNumber,
            checkout_url: session.url,
            session_id: session.id,
        });
    }
    catch (err) {
        console.error('Checkout error:', err);
        return c.json({ success: false, error: err.message || 'Payment initiation failed' }, 500);
    }
});
export { checkoutApp };
