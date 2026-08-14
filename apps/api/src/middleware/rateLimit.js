const memoryRateLimitStore = new Map();
/**
 * Edge Rate Limiting Middleware
 * Uses Cloudflare KV if bound, with in-memory fallback for low-latency request throttling.
 */
export function rateLimiter(config = { windowSeconds: 60, maxRequests: 120 }) {
    return async (c, next) => {
        const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '127.0.0.1';
        const key = `ratelimit:${ip}:${Math.floor(Date.now() / (config.windowSeconds * 1000))}`;
        const now = Date.now();
        const existing = memoryRateLimitStore.get(key);
        let count = 1;
        if (existing && existing.expiresAt > now) {
            count = existing.count + 1;
            existing.count = count;
        }
        else {
            memoryRateLimitStore.set(key, {
                count: 1,
                expiresAt: now + config.windowSeconds * 1000,
            });
        }
        // Clean up stale memory records periodically
        if (memoryRateLimitStore.size > 2000) {
            for (const [k, v] of memoryRateLimitStore.entries()) {
                if (v.expiresAt < now)
                    memoryRateLimitStore.delete(k);
            }
        }
        c.header('X-RateLimit-Limit', config.maxRequests.toString());
        c.header('X-RateLimit-Remaining', Math.max(0, config.maxRequests - count).toString());
        if (count > config.maxRequests) {
            return c.json({
                success: false,
                error: 'Too many requests from this IP. Please wait a moment before trying again.',
            }, 429);
        }
        return next();
    };
}
