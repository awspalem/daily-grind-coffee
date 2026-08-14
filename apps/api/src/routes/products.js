import { Hono } from 'hono';
import { CoffeeDatabase } from '@daily-grind/db';
const productsApp = new Hono();
// GET /api/categories
productsApp.get('/categories', async (c) => {
    const db = new CoffeeDatabase(c.env.DB);
    const categories = await db.getAllCategories();
    return c.json({ success: true, categories });
});
// GET /api/products
productsApp.get('/products', async (c) => {
    const categoryId = c.req.query('category');
    const roastLevel = c.req.query('roast');
    const db = new CoffeeDatabase(c.env.DB);
    const products = await db.getAllProducts(categoryId, roastLevel);
    return c.json({ success: true, count: products.length, products });
});
// GET /api/products/:identifier
productsApp.get('/products/:identifier', async (c) => {
    const identifier = c.req.param('identifier');
    const db = new CoffeeDatabase(c.env.DB);
    const product = await db.getProductBySlugOrId(identifier);
    if (!product) {
        return c.json({ success: false, error: 'Product not found' }, 404);
    }
    return c.json({ success: true, product });
});
// GET /api/brewing-guides
productsApp.get('/brewing-guides', async (c) => {
    const db = new CoffeeDatabase(c.env.DB);
    const guides = await db.getBrewingGuides();
    return c.json({ success: true, guides });
});
export { productsApp };
