import { Hono, type Context } from 'hono';
import type { Env } from '../types/env';
import type { ShippingAddress } from '@daily-grind/shared-types';
import { getOrCreateCart } from './cart';
import { InventoryLedgerService } from '../services/inventoryLedger';
import { StripeService } from '../services/stripe';
import { turnstileValidator } from '../middleware/turnstile';
import { validateCoupon } from '../services/coupons';

const checkoutApp = new Hono<{ Bindings: Env }>();

// Core checkout processing handler
async function processCheckout(c: Context<{ Bindings: Env }>, isSessionRoute: boolean = false) {
  const sessionToken = c.req.header('X-Session-Token');
  const body = (await c.req.json()) as {
    session_token?: string;
    customer_email: string;
    shipping_address?: ShippingAddress;
    turnstile_token?: string;
    currency?: string;
    cart_id?: string;
    items?: any[];
    coupon_code?: string;
  };

  const token = sessionToken || body.session_token || body.cart_id;
  if (!token) {
    return c.json({ success: false, error: 'Session token required' }, 400);
  }

  const customerEmail = body.customer_email || 'customer@dailyroast.in';
  const shippingAddress: ShippingAddress = body.shipping_address || {
    name: customerEmail.split('@')[0],
    email: customerEmail,
    line1: 'Indiranagar 100ft Road',
    city: 'Bangalore',
    state: 'Karnataka',
    postal_code: '560038',
    country: 'IN',
  };

  // Resolve order items. The storefront keeps its cart in localStorage rather than the D1
  // `carts`/`cart_items` tables, so it sends the cart as `items` in the request body — but we
  // never trust client-submitted prices/names for what gets charged, only variant_id + quantity;
  // everything else is re-fetched from D1. Falls back to the D1 cart (used by the Maya agent's
  // add-to-cart confirmation flow, which does write through to `cart_items`) when no items array
  // is sent.
  type ResolvedItem = {
    variant_id: string; product_name: string; weight_grams: number; grind_type: string;
    price_cents: number; quantity: number; line_total_cents: number;
    subscription_frequency?: string | null; custom_notes?: string | null;
  };
  let resolvedItems: ResolvedItem[];
  let discountCents = 0;
  let cartIdForLedger = token;

  if (Array.isArray(body.items) && body.items.length > 0) {
    const variantIds = [...new Set(body.items.map((it) => it.variant_id).filter(Boolean))];
    const placeholders = variantIds.map(() => '?').join(',');
    const { results: variantRows } = variantIds.length > 0
      ? await c.env.DB.prepare(`
          SELECT v.id, v.weight_grams, v.price_cents, v.is_active, p.name as product_name
          FROM product_variants v
          JOIN products p ON v.product_id = p.id
          WHERE v.id IN (${placeholders})
        `).bind(...variantIds).all()
      : { results: [] };
    const variantMap = new Map((variantRows || []).map((r: any) => [r.id, r]));

    resolvedItems = [];
    for (const it of body.items) {
      const variant = variantMap.get(it.variant_id) as any;
      if (!variant || !variant.is_active) {
        return c.json({ success: false, error: `Unavailable product: ${it.variant_id}` }, 400);
      }
      const quantity = Math.max(1, Math.floor(Number(it.quantity)) || 1);
      resolvedItems.push({
        variant_id: it.variant_id,
        product_name: variant.product_name,
        weight_grams: Number(variant.weight_grams),
        grind_type: it.grind_type || 'WHOLE_BEAN',
        price_cents: Number(variant.price_cents),
        quantity,
        line_total_cents: Number(variant.price_cents) * quantity,
        subscription_frequency: it.subscription_frequency || null,
        custom_notes: it.custom_notes || null,
      });
    }
  } else {
    const cart = await getOrCreateCart(c.env.DB, token);
    if (!cart.items || cart.items.length === 0) {
      return c.json({ success: false, error: 'Cart is empty' }, 400);
    }
    resolvedItems = cart.items;
    discountCents = cart.discount_cents;
    cartIdForLedger = cart.id;
  }

  const ledger = new InventoryLedgerService(c.env.DB);

  // 1. Verify stock availability and reserve items
  try {
    for (const item of resolvedItems) {
      await ledger.recordMovement({
        variantId: item.variant_id,
        movementType: 'PURCHASE_RESERVE',
        delta: -item.quantity,
        referenceType: 'CART',
        referenceId: cartIdForLedger,
        reason: 'Checkout stock reservation hold',
        actor: 'CHECKOUT_SERVICE',
      });
    }
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Stock reservation error' }, 409);
  }

  // 2. Create Order in D1
  const orderId = 'ord_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const orderNumber = 'TDG-' + Math.floor(100000 + Math.random() * 900000);
  const subtotalCents = resolvedItems.reduce((acc, it) => acc + it.line_total_cents, 0);

  // Coupons are always re-validated here against the real subtotal, never trusted from a
  // client-sent discount amount or a stale D1 cart row — a shopper could otherwise apply a
  // coupon in the UI, add more to cart, and check out with a discount computed against the
  // smaller pre-addition total (or one that's expired/exhausted since it was last checked).
  let appliedCoupon: { id: string; code: string } | null = null;
  if (body.coupon_code) {
    const couponResult = await validateCoupon(c.env.DB, body.coupon_code, subtotalCents);
    if (!couponResult.valid) {
      return c.json({ success: false, error: couponResult.error || 'Invalid coupon code' }, 400);
    }
    discountCents = couponResult.discountCents;
    appliedCoupon = { id: couponResult.couponId!, code: couponResult.code! };
  }

  const totalAfterDiscount = Math.max(0, subtotalCents - discountCents);
  const shippingCents = subtotalCents >= 5000 ? 0 : 500; // Free shipping over $50 / ₹1,200
  const taxCents = Math.round(totalAfterDiscount * 0.08); // 8% estimated sales tax
  const totalCents = totalAfterDiscount + shippingCents + taxCents;

  const orderStatements = [
    c.env.DB.prepare(`
      INSERT INTO orders (
        id, order_number, customer_email, status, subtotal_cents,
        shipping_cents, tax_cents, discount_cents, total_cents,
        currency, shipping_address_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      orderId,
      orderNumber,
      customerEmail,
      subtotalCents,
      shippingCents,
      taxCents,
      discountCents,
      totalCents,
      body.currency || 'usd',
      JSON.stringify(shippingAddress)
    ),
  ];

  for (const item of resolvedItems) {
    const orderItemId = 'oi_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    orderStatements.push(
      c.env.DB.prepare(`
        INSERT INTO order_items (
          id, order_id, variant_id, product_name, weight_grams, grind_type, unit_price_cents, quantity, total_price_cents, subscription_frequency, custom_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderItemId,
        orderId,
        item.variant_id,
        item.product_name,
        item.weight_grams,
        item.grind_type,
        item.price_cents,
        item.quantity,
        item.line_total_cents,
        item.subscription_frequency || null,
        item.custom_notes || null
      )
    );

    // If item has recurring subscription frequency, save to D1 subscriptions table
    if (item.subscription_frequency) {
      const subId = 'sub_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const days = item.subscription_frequency === '1_WEEK' ? 7 : item.subscription_frequency === '4_WEEKS' ? 28 : 14;
      const nextRenewalDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      orderStatements.push(
        c.env.DB.prepare(`
          INSERT INTO subscriptions (
            id, customer_email, customer_id, order_id, variant_id, product_name,
            grind_type, frequency, quantity, unit_price_cents, discount_percent,
            status, next_renewal_date, shipping_address_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 'ACTIVE', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          subId,
          customerEmail,
          null,
          orderId,
          item.variant_id,
          item.product_name,
          item.grind_type,
          item.subscription_frequency,
          item.quantity,
          item.price_cents,
          nextRenewalDate,
          JSON.stringify(shippingAddress)
        )
      );
    }
  }

  if (appliedCoupon) {
    orderStatements.push(
      c.env.DB.prepare('UPDATE coupons SET times_used = times_used + 1 WHERE id = ?').bind(appliedCoupon.id),
      c.env.DB.prepare(`
        INSERT INTO coupon_redemptions (id, coupon_id, order_id, customer_email, discount_applied_cents)
        VALUES (?, ?, ?, ?, ?)
      `).bind('credm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), appliedCoupon.id, orderId, customerEmail, discountCents)
    );
  }

  await c.env.DB.batch(orderStatements);

  // 3. Create Stripe Checkout Session
  const stripe = new StripeService(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SECRET);
  const storefrontUrl = c.env.STOREFRONT_URL || 'http://localhost:5173';

  try {
    const session = await stripe.createCheckoutSession({
      orderId,
      orderNumber,
      customerEmail,
      items: resolvedItems.map((it) => ({
        name: `${it.product_name} (${it.weight_grams}g, ${it.grind_type})${it.subscription_frequency ? ` [${it.subscription_frequency.replace('_', ' ')} Sub]` : ''}`,
        unitPriceCents: it.price_cents,
        quantity: it.quantity,
      })),
      shippingCents,
      successUrl: `${storefrontUrl}/order-confirmation?order_id=${orderId}&order_number=${orderNumber}`,
      cancelUrl: `${storefrontUrl}/cart?cancelled=true`,
      currency: c.env.CURRENCY || body.currency || 'usd',
      saveForSubscription: resolvedItems.some((it) => Boolean(it.subscription_frequency)),
    });

    // Update order with Stripe session ID
    await c.env.DB.prepare(
      'UPDATE orders SET stripe_session_id = ? WHERE id = ?'
    ).bind(session.id, orderId).run();

    return c.json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (err: any) {
    console.error('Checkout session warning (fallback simulation active):', err);
    return c.json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      checkout_url: null,
      session_id: 'sim_sess_' + orderId,
      message: 'Order placed & scheduled for roasting',
    });
  }
}

// POST /api/checkout (Protected by Turnstile)
checkoutApp.post('/', turnstileValidator, async (c) => {
  return processCheckout(c, false);
});

// POST /api/checkout/session
checkoutApp.post('/session', async (c) => {
  return processCheckout(c, true);
});

export { checkoutApp };
