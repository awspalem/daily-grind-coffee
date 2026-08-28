import { Hono } from 'hono';
import { CoffeeDatabase } from '@daily-grind/db';
import type { Env } from '../types/env';
import { lookupCustomerSession } from '../middleware/customerAuth';

const productsApp = new Hono<{ Bindings: Env }>();

// GET /api/categories
// Public read — categories change ~once a quarter, so a long edge cache is safe.
productsApp.get('/categories', async (c) => {
  const db = new CoffeeDatabase(c.env.DB);
  const categories = await db.getAllCategories();
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return c.json({ success: true, categories });
});

// GET /api/products
// Public read — products move more often than categories (price, stock), so a
// shorter browser cache and a longer shared cache lets Cloudflare absorb the
// repeat-visit traffic while a price update propagates within the hour.
productsApp.get('/products', async (c) => {
  const categoryId = c.req.query('category');
  const roastLevel = c.req.query('roast');
  const db = new CoffeeDatabase(c.env.DB);
  const products = await db.getAllProducts(categoryId, roastLevel);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
  return c.json({ success: true, count: products.length, products });
});

// GET /api/products/:identifier
// Single product. PDP reloads happen often; keep the edge cache wider than the
// list endpoint so the second visit is instant.
productsApp.get('/products/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const db = new CoffeeDatabase(c.env.DB);
  const product = await db.getProductBySlugOrId(identifier);

  if (!product) {
    return c.json({ success: false, error: 'Product not found' }, 404);
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=600');
  return c.json({ success: true, product });
});

// GET /api/brewing-guides
// Public read — guides change with new brew methods, maybe once a quarter.
productsApp.get('/brewing-guides', async (c) => {
  const db = new CoffeeDatabase(c.env.DB);
  const guides = await db.getBrewingGuides();
  c.header('Cache-Control', 'public, max-age=600, s-maxage=86400');
  return c.json({ success: true, guides });
});

// POST /api/products/notify-me — join the back-in-stock list for a variant.
// Body: { variant_id, email }. Works logged-out; if the email matches a known customer the row
// is linked so their channel preferences and push subscriptions apply when the restock fires.
// The hourly cron (services/notifications.ts:notifyBackInStock) does the sending.
productsApp.post('/products/notify-me', async (c) => {
  const body = await c.req.json<{ variant_id?: string; email?: string }>().catch(() => ({} as any));
  const variantId = (body.variant_id || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  if (!variantId || !email || !email.includes('@')) {
    return c.json({ success: false, error: 'variant_id and a valid email are required' }, 400);
  }

  const variant = await c.env.DB.prepare(
    'SELECT v.id, COALESCE(i.available_stock, 0) AS available_stock FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.id = ?'
  ).bind(variantId).first<{ id: string; available_stock: number }>();
  if (!variant) return c.json({ success: false, error: 'Unknown variant' }, 404);

  if (Number(variant.available_stock) > 0) {
    // Already in stock — nothing to wait for. Tell the caller so the UI can just show "Add to cart".
    return c.json({ success: true, in_stock: true });
  }

  // Link to a customer if this email owns an account, or if the caller has a live session.
  let customerId: string | null = null;
  const byEmail = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<{ id: string }>();
  if (byEmail) {
    customerId = byEmail.id;
  } else {
    const lookup = await lookupCustomerSession(c.env.DB, c.req.header('X-Customer-Session'));
    if (lookup.kind === 'ok') customerId = lookup.session.customerId;
  }

  const id = 'stk_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  // Re-subscribing (same variant + email) clears notified_at so the next restock notifies again.
  await c.env.DB.prepare(`
    INSERT INTO stock_notifications (id, variant_id, email, customer_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(variant_id, email) DO UPDATE SET
      customer_id = COALESCE(excluded.customer_id, stock_notifications.customer_id),
      notified_at = NULL,
      created_at = CURRENT_TIMESTAMP
  `).bind(id, variantId, email, customerId).run();

  return c.json({ success: true, in_stock: false });
});

export { productsApp };
