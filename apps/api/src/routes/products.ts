import { Hono } from 'hono';
import { CoffeeDatabase } from '@daily-grind/db';
import type { Env } from '../types/env';

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

export { productsApp };
