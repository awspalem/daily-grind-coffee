// In-memory fallback when CONFIG_KV isn't bound (dev). Per-isolate — at the
// edge that's per-isolate-population, not truly global, but it's a fair
// backstop when KV is missing and good enough for local dev.
const memoryRateLimitStore = new Map();
/**
 * Edge Rate Limiting Middleware.
 *
 * Counts requests in CONFIG_KV (when bound) so the limit is global across
 * every Worker isolate at the edge. Falls back to an in-memory Map when KV
 * is unbound (local dev with `wrangler dev` minus --persist), which gives
 * the right shape but not the right scale — an attacker hitting a cold
 * isolate gets a fresh budget.
 *
 * The KV key is windowed (the timestamp is embedded), so KV's natural TTL
 * handles expiry without any cleanup pass.
 */
export function rateLimiter(config = { windowSeconds: 60, maxRequests: 120 }) {
    return async (c, next) => {
        const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '127.0.0.1';
        const windowIndex = Math.floor(Date.now() / (config.windowSeconds * 1000));
        const key = `ratelimit:${ip}:${windowIndex}`;
        const kv = c.env.CONFIG_KV;
        let count;
        if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
            try {
                // KV doesn't have atomic increment, so we read-modify-write. The race
                // is acceptable: at worst a few requests slip through under contention.
                const current = await kv.get(key);
                count = current ? Number(current) + 1 : 1;
                // TTL = window + a small grace so a write at the edge of the window
                // doesn't get reaped before the next reader.
                await kv.put(key, String(count), { expirationTtl: config.windowSeconds + 5 });
            }
            catch (err) {
                console.warn('[rateLimit] KV read/write failed, falling back to memory:', err);
                count = memoryIncrement(memoryRateLimitStore, key, config.windowSeconds * 1000);
            }
        }
        else {
            count = memoryIncrement(memoryRateLimitStore, key, config.windowSeconds * 1000);
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
/**
 * Per-session-token rate limit. Used by the agent chat endpoints so a
 * signed-out IP shared with many visitors doesn't share a budget. The
 * bucket key is `X-Session-Token` (or, for admin, `X-Admin-Session`); when
 * the header is missing the request is allowed through unmetered so a
 * brand-new browser tab can still open the chat.
 *
 * Same KV + memory-store pattern as the IP rate limiter so the in-memory
 * fallback in dev covers both. A different `scope` keeps its bucket
 * separate from the IP limiter, so the two never cross-count.
 */
export function sessionRateLimiter(config = { windowSeconds: 600, maxRequests: 30 }) {
    const { windowSeconds, maxRequests, sessionHeader = 'X-Session-Token', scope = 'session_default' } = config;
    return async (c, next) => {
        const session = c.req.header(sessionHeader);
        if (!session)
            return next();
        const windowIndex = Math.floor(Date.now() / (windowSeconds * 1000));
        const key = `ratelimit:${scope}:session:${session.slice(0, 32)}:${windowIndex}`;
        const kv = c.env.CONFIG_KV;
        let count;
        if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
            try {
                const current = await kv.get(key);
                count = current ? Number(current) + 1 : 1;
                await kv.put(key, String(count), { expirationTtl: windowSeconds + 5 });
            }
            catch (err) {
                console.warn('[sessionRateLimit] KV read/write failed, falling back to memory:', err);
                count = memoryIncrement(memoryRateLimitStore, key, windowSeconds * 1000);
            }
        }
        else {
            count = memoryIncrement(memoryRateLimitStore, key, windowSeconds * 1000);
        }
        c.header('X-RateLimit-Limit', maxRequests.toString());
        c.header('X-RateLimit-Remaining', Math.max(0, maxRequests - count).toString());
        if (count > maxRequests) {
            return c.json({
                success: false,
                error: 'You are sending messages a little too quickly. Please take a sip of coffee and try again in a minute.',
            }, 429);
        }
        return next();
    };
}
function memoryIncrement(store, key, windowMs) {
    const now = Date.now();
    const existing = store.get(key);
    let count = 1;
    if (existing && existing.expiresAt > now) {
        count = existing.count + 1;
        existing.count = count;
    }
    else {
        store.set(key, { count: 1, expiresAt: now + windowMs });
    }
    // Amortized cleanup — avoid scanning the whole map on every request.
    if (store.size > 2000) {
        for (const [k, v] of store.entries()) {
            if (v.expiresAt < now)
                store.delete(k);
        }
    }
    return count;
}
