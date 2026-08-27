// Cloudflare Access only injects the Cf-Access-* headers on requests that hit
// a hostname covered by an Access application. The admin SPA at
// admin.dailyroast.in is gated, so it gets the headers; the API at
// api.dailyroast.in is not, so the same browser session cannot pass the header
// check when the SPA calls the API cross-origin. The CF_Authorization cookie,
// however, IS forwarded by the browser with credentials: 'include', and we
// can verify it ourselves against the team's published JWKS — decoupling API
// auth from the Access application's hostname.
const JWKS_CACHE_KEY = 'cf_access_jwks_v1';
const JWKS_CACHE_TTL_SECONDS = 3600;
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k)
            out[k] = decodeURIComponent(v);
    }
    return out;
}
function base64UrlDecode(input) {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function base64UrlDecodeJson(input) {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(input)));
}
async function importJwk(jwk) {
    return crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
async function loadJwks(c) {
    // KV is the best cache here: it survives isolate eviction so a hot path
    // never hits the team domain. Falls back to in-memory on a miss if KV is
    // unbound (dev) or if the KV read errors.
    const kv = c.env.CONFIG_KV;
    if (kv && typeof kv.get === 'function') {
        try {
            const cached = await kv.get(JWKS_CACHE_KEY, 'json');
            if (cached)
                return cached;
        }
        catch (err) {
            console.warn('[zeroTrust] KV JWKS read failed, falling through to fetch:', err);
        }
    }
    const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
    if (!teamDomain)
        throw new Error('ACCESS_TEAM_DOMAIN is not configured');
    const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!res.ok)
        throw new Error(`JWKS fetch returned ${res.status}`);
    const jwks = (await res.json());
    if (kv && typeof kv.put === 'function') {
        try {
            await kv.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL_SECONDS });
        }
        catch (err) {
            console.warn('[zeroTrust] KV JWKS write failed, continuing:', err);
        }
    }
    return jwks;
}
async function verifyCFAuthCookie(c, cookieValue) {
    const parts = cookieValue.split('.');
    if (parts.length !== 3)
        return { ok: false, reason: 'malformed JWT' };
    const [headerB64, payloadB64, signatureB64] = parts;
    let header;
    let claims;
    try {
        header = base64UrlDecodeJson(headerB64);
        claims = base64UrlDecodeJson(payloadB64);
    }
    catch {
        return { ok: false, reason: 'undecodable JWT' };
    }
    if (!header.kid)
        return { ok: false, reason: 'missing kid' };
    if (header.alg && header.alg !== 'RS256')
        return { ok: false, reason: 'unsupported alg' };
    let jwks;
    try {
        jwks = await loadJwks(c);
    }
    catch (err) {
        console.error('[zeroTrust] JWKS load failed:', err);
        return { ok: false, reason: 'JWKS unavailable' };
    }
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk)
        return { ok: false, reason: 'unknown kid' };
    const key = await importJwk(jwk);
    const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, base64UrlDecode(signatureB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
    if (!ok)
        return { ok: false, reason: 'signature mismatch' };
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now)
        return { ok: false, reason: 'expired' };
    if (c.env.ACCESS_AUD) {
        const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!auds.includes(c.env.ACCESS_AUD))
            return { ok: false, reason: 'aud mismatch' };
    }
    if (!claims.email)
        return { ok: false, reason: 'no email claim' };
    return { ok: true, email: claims.email };
}
/**
 * Zero Trust Access & Admin Auth Middleware
 * Accepts, in order:
 *   1. Cf-Access-Jwt-Assertion + Cf-Access-Authenticated-User-Email headers
 *      (same-host Access application — zero round-trips on the happy path).
 *   2. A verified CF_Authorization cookie (cross-origin SPA → API).
 *   3. In non-production, a Bearer token from ADMIN_TOKEN.
 *   4. In non-production with no ADMIN_TOKEN set, an open dev bypass.
 *   5. Otherwise: 401.
 */
export async function zeroTrustAdminGuard(c, next) {
    const cfEmail = c.req.header('Cf-Access-Authenticated-User-Email');
    const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');
    const authHeader = c.req.header('Authorization');
    const actorEmail = cfEmail || 'admin-local@dailyroast.in';
    const actorId = 'actor_admin_01';
    const isProduction = c.env.ENVIRONMENT === 'production';
    // Primary path: Cloudflare Access has already verified the user and forwarded a signed JWT.
    if (cfJwt && cfEmail) {
        c.set('adminActor', {
            id: 'zt_' + cfEmail,
            email: cfEmail,
            role: 'ADMIN',
        });
        return next();
    }
    // Cross-origin fallback: verify the CF_Authorization cookie ourselves.
    if (isProduction && c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) {
        const cookies = parseCookies(c.req.header('Cookie'));
        const cfAuth = cookies['CF_Authorization'];
        if (cfAuth) {
            const result = await verifyCFAuthCookie(c, cfAuth);
            if (result.ok) {
                c.set('adminActor', {
                    id: 'zt_' + result.email,
                    email: result.email,
                    role: 'ADMIN',
                });
                return next();
            }
            console.warn('[zeroTrust] CF_Authorization cookie rejected:', result.reason);
        }
    }
    // Fallback: a pre-shared bearer token, for local tooling/scripts. Only ever trusted when a
    // real ADMIN_TOKEN secret is configured — never a hardcoded literal, and never in production
    // (production must go through Cloudflare Access above).
    if (!isProduction && authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN) {
            c.set('adminActor', {
                id: actorId,
                email: actorEmail,
                role: 'ADMIN',
            });
            return next();
        }
    }
    // Non-production with no ADMIN_TOKEN configured at all: allow through for local dev only.
    if (!isProduction && !c.env.ADMIN_TOKEN) {
        c.set('adminActor', {
            id: 'local_dev_admin',
            email: 'roaster@dailyroast.in',
            role: 'ADMIN',
        });
        return next();
    }
    return c.json({
        success: false,
        error: 'Access Denied: Protected by Cloudflare Zero Trust Access authentication.',
    }, 401);
}
/**
 * Audit Logging Helper
 * Writes privileged admin changes to D1 audit_log
 */
export async function recordAuditLog(db, actor, action, entityType, entityId, oldVal, newVal, ip) {
    const id = 'aud_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await db.prepare(`
    INSERT INTO audit_log (
      id, actor_id, actor_email, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(id, actor.id, actor.email, action, entityType, entityId, oldVal ? JSON.stringify(oldVal) : null, newVal ? JSON.stringify(newVal) : null, ip || null).run();
}
