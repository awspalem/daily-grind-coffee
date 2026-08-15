import { Hono } from 'hono';
import type { Env } from '../types/env';
import { turnstileValidator } from '../middleware/turnstile';

const reviewsApp = new Hono<{ Bindings: Env }>();

// GET /api/reviews/summary — {product_id: {avg_rating, review_count}} for every product with
// at least one review, in a single query (used to show star ratings on product cards without
// firing one request per product).
reviewsApp.get('/summary', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as review_count
    FROM reviews
    GROUP BY product_id
  `).all<{ product_id: string; avg_rating: number; review_count: number }>();

  const summary: Record<string, { avg_rating: number; review_count: number }> = {};
  for (const row of results || []) {
    summary[row.product_id] = {
      avg_rating: Math.round(Number(row.avg_rating) * 10) / 10,
      review_count: Number(row.review_count),
    };
  }
  return c.json({ success: true, summary });
});

// GET /api/reviews/:productId — full review list + summary for one product
reviewsApp.get('/:productId', async (c) => {
  const productId = c.req.param('productId');

  const { results: reviews } = await c.env.DB.prepare(`
    SELECT id, customer_name, rating, comment, is_verified_purchase, created_at
    FROM reviews
    WHERE product_id = ?
    ORDER BY created_at DESC
  `).bind(productId).all();

  const stats = await c.env.DB.prepare(`
    SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
    FROM reviews WHERE product_id = ?
  `).bind(productId).first<{ avg_rating: number | null; review_count: number }>();

  return c.json({
    success: true,
    reviews: reviews || [],
    avg_rating: stats?.avg_rating ? Math.round(Number(stats.avg_rating) * 10) / 10 : null,
    review_count: Number(stats?.review_count || 0),
  });
});

// POST /api/reviews — submit a new review (Turnstile-protected against bot spam)
reviewsApp.post('/', turnstileValidator, async (c) => {
  const body = await c.req.json<{
    product_id?: string;
    customer_name?: string;
    rating?: number;
    comment?: string;
    order_number?: string;
  }>().catch(() => ({} as any));

  const productId = (body.product_id || '').trim();
  const customerName = (body.customer_name || '').trim();
  const comment = (body.comment || '').trim();
  const rating = Math.round(Number(body.rating));

  if (!productId || !customerName || !comment || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    return c.json({ success: false, error: 'product_id, customer_name, comment, and a rating (1-5) are required' }, 400);
  }
  if (customerName.length > 80 || comment.length > 2000) {
    return c.json({ success: false, error: 'Review text is too long' }, 400);
  }

  const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) {
    return c.json({ success: false, error: 'Unknown product' }, 404);
  }

  let isVerifiedPurchase = false;
  const orderNumber = (body.order_number || '').trim() || null;
  if (orderNumber) {
    const order = await c.env.DB.prepare(`
      SELECT o.id FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants v ON v.id = oi.variant_id
      WHERE o.order_number = ? AND v.product_id = ?
      LIMIT 1
    `).bind(orderNumber, productId).first();
    isVerifiedPurchase = Boolean(order);
  }

  const id = 'rev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await c.env.DB.prepare(`
    INSERT INTO reviews (id, product_id, customer_name, rating, comment, order_number, is_verified_purchase)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, productId, customerName, rating, comment, orderNumber, isVerifiedPurchase ? 1 : 0).run();

  return c.json({ success: true, review: { id, product_id: productId, customer_name: customerName, rating, comment, is_verified_purchase: isVerifiedPurchase } });
});

export { reviewsApp };
