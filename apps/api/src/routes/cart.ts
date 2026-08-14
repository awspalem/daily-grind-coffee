import { Hono } from 'hono';
import type { Env } from '../types/env';
import type { Cart, CartItem, GrindType } from '@daily-grind/shared-types';

const cartApp = new Hono<{ Bindings: Env }>();

// Helper to get or create a cart by session token
async function getOrCreateCart(db: any, sessionToken?: string): Promise<Cart> {
  const token = sessionToken || 'sess_' + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  let cart = await db.prepare(
    'SELECT * FROM carts WHERE session_token = ?'
  ).bind(token).first();

  if (!cart) {
    const cartId = 'cart_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await db.prepare(`
      INSERT INTO carts (id, session_token, applied_coupon_code, discount_cents, expires_at)
      VALUES (?, ?, NULL, 0, ?)
    `).bind(cartId, token, expiresAt).run();

    cart = {
      id: cartId,
      session_token: token,
      applied_coupon_code: null,
      discount_cents: 0,
      expires_at: expiresAt,
    };
  }

  // Fetch items with joined variant & product info
  const { results: rawItems } = await db.prepare(`
    SELECT 
      ci.id,
      ci.cart_id,
      ci.variant_id,
      ci.grind_type,
      ci.quantity,
      ci.unit_price_cents,
      v.weight_grams,
      v.price_cents as current_price_cents,
      p.id as product_id,
      p.name as product_name,
      p.slug as product_slug,
      p.image_url
    FROM cart_items ci
    JOIN product_variants v ON ci.variant_id = v.id
    JOIN products p ON v.product_id = p.id
    WHERE ci.cart_id = ?
    ORDER BY ci.created_at ASC
  `).bind(cart.id).all();

  const items: CartItem[] = (rawItems || []).map((row: any) => ({
    id: row.id,
    cart_id: row.cart_id,
    variant_id: row.variant_id,
    product_id: row.product_id,
    product_name: row.product_name,
    product_slug: row.product_slug,
    image_url: row.image_url,
    weight_grams: Number(row.weight_grams),
    grind_type: row.grind_type as GrindType,
    price_cents: Number(row.unit_price_cents),
    quantity: Number(row.quantity),
    line_total_cents: Number(row.unit_price_cents) * Number(row.quantity),
  }));

  const subtotalCents = items.reduce((acc, it) => acc + it.line_total_cents, 0);
  const discountCents = Number(cart.discount_cents || 0);
  const totalCents = Math.max(0, subtotalCents - discountCents);

  return {
    id: cart.id,
    session_token: cart.session_token,
    items,
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    applied_coupon_code: cart.applied_coupon_code || undefined,
    total_cents: totalCents,
    expires_at: cart.expires_at,
    created_at: cart.created_at || new Date().toISOString(),
    updated_at: cart.updated_at || new Date().toISOString(),
  };
}

// GET /api/cart
cartApp.get('/', async (c) => {
  const sessionToken = c.req.header('X-Session-Token') || c.req.query('session_token');
  const cart = await getOrCreateCart(c.env.DB, sessionToken);
  return c.json({ success: true, cart });
});

// POST /api/cart/items
cartApp.post('/items', async (c) => {
  const sessionToken = c.req.header('X-Session-Token') || c.req.query('session_token');
  const body = await c.req.json<{
    variant_id: string;
    grind_type: GrindType;
    quantity?: number;
  }>();

  if (!body.variant_id || !body.grind_type) {
    return c.json({ success: false, error: 'variant_id and grind_type are required' }, 400);
  }

  const quantity = Math.max(1, body.quantity || 1);
  const cart = await getOrCreateCart(c.env.DB, sessionToken);

  // Validate variant & get price
  const variant = await c.env.DB.prepare(
    'SELECT price_cents FROM product_variants WHERE id = ? AND is_active = 1'
  ).bind(body.variant_id).first<{ price_cents: number }>();

  if (!variant) {
    return c.json({ success: false, error: 'Invalid product variant' }, 404);
  }

  // Insert or update existing cart item
  const existingItem = await c.env.DB.prepare(
    'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ? AND grind_type = ?'
  ).bind(cart.id, body.variant_id, body.grind_type).first<{ id: string; quantity: number }>();

  if (existingItem) {
    await c.env.DB.prepare(
      'UPDATE cart_items SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(quantity, existingItem.id).run();
  } else {
    const itemId = 'ci_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await c.env.DB.prepare(`
      INSERT INTO cart_items (id, cart_id, variant_id, grind_type, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(itemId, cart.id, body.variant_id, body.grind_type, quantity, variant.price_cents).run();
  }

  const updatedCart = await getOrCreateCart(c.env.DB, cart.session_token);
  return c.json({ success: true, cart: updatedCart });
});

// PATCH /api/cart/items/:id
cartApp.patch('/items/:id', async (c) => {
  const itemId = c.req.param('id');
  const sessionToken = c.req.header('X-Session-Token') || c.req.query('session_token');
  const body = await c.req.json<{ quantity: number }>();

  const quantity = Number(body.quantity);
  if (isNaN(quantity) || quantity < 0) {
    return c.json({ success: false, error: 'Valid quantity required' }, 400);
  }

  if (quantity === 0) {
    await c.env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();
  } else {
    await c.env.DB.prepare('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(quantity, itemId).run();
  }

  const cart = await getOrCreateCart(c.env.DB, sessionToken);
  return c.json({ success: true, cart });
});

// DELETE /api/cart/items/:id
cartApp.delete('/items/:id', async (c) => {
  const itemId = c.req.param('id');
  const sessionToken = c.req.header('X-Session-Token') || c.req.query('session_token');
  
  await c.env.DB.prepare('DELETE FROM cart_items WHERE id = ?').bind(itemId).run();

  const cart = await getOrCreateCart(c.env.DB, sessionToken);
  return c.json({ success: true, cart });
});

// POST /api/cart/coupon
cartApp.post('/coupon', async (c) => {
  const sessionToken = c.req.header('X-Session-Token') || c.req.query('session_token');
  const body = await c.req.json<{ code: string }>();

  if (!body.code) {
    return c.json({ success: false, error: 'Coupon code required' }, 400);
  }

  const coupon = await c.env.DB.prepare(
    'SELECT * FROM coupons WHERE code = ? AND is_active = 1'
  ).bind(body.code.trim().toUpperCase()).first<any>();

  if (!coupon) {
    return c.json({ success: false, error: 'Invalid or expired coupon code' }, 400);
  }

  const cart = await getOrCreateCart(c.env.DB, sessionToken);
  if (cart.subtotal_cents < coupon.minimum_order_cents) {
    return c.json({ 
      success: false, 
      error: `Minimum order amount of $${(coupon.minimum_order_cents / 100).toFixed(2)} required for this code` 
    }, 400);
  }

  let discountCents = 0;
  if (coupon.discount_type === 'PERCENT') {
    discountCents = Math.round((cart.subtotal_cents * coupon.discount_value) / 100);
  } else {
    discountCents = coupon.discount_value;
  }

  await c.env.DB.prepare(
    'UPDATE carts SET applied_coupon_code = ?, discount_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(coupon.code, discountCents, cart.id).run();

  const updatedCart = await getOrCreateCart(c.env.DB, sessionToken);
  return c.json({ success: true, cart: updatedCart, message: `Applied coupon ${coupon.code}!` });
});

export { cartApp, getOrCreateCart };
