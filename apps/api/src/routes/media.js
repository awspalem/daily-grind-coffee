import { Hono } from 'hono';
import { zeroTrustAdminGuard } from '../middleware/zeroTrust';
const mediaApp = new Hono();
// GET /api/media/:key (Serve from R2 with edge caching)
mediaApp.get('/:key', async (c) => {
    const key = c.req.param('key');
    if (!c.env.MEDIA_BUCKET) {
        // In local development or before R2 bind, redirect or return fallback
        return c.redirect(`https://images.unsplash.com/photo-1587734195503-904fca47e0e9?auto=format&fit=crop&w=800&q=80`);
    }
    const object = await c.env.MEDIA_BUCKET.get(key);
    if (!object) {
        return c.json({ success: false, error: 'Media asset not found in R2' }, 404);
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
});
// POST /api/media/upload (Protected by Zero Trust Admin)
mediaApp.post('/upload', zeroTrustAdminGuard, async (c) => {
    if (!c.env.MEDIA_BUCKET) {
        return c.json({ success: true, url: 'https://images.unsplash.com/photo-1587734195503-904fca47e0e9', key: 'mock_asset_key' });
    }
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file) {
        return c.json({ success: false, error: 'File is required' }, 400);
    }
    const key = `catalog/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    await c.env.MEDIA_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'image/jpeg' },
    });
    return c.json({
        success: true,
        key,
        url: `/api/media/${key}`,
    });
});
export { mediaApp };
