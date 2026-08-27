import type { Context, Next } from 'hono';
import type { Env } from '../types/env';

export interface AdminActor {
  id: string;
  email: string;
  role: 'ADMIN' | 'ROASTER' | 'SUPPORT';
}

export interface AdminVariables {
  adminActor: AdminActor;
}

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

interface AccessJwk {
  kid: string;
  kty: 'RSA';
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface AccessJwks {
  keys: AccessJwk[];
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(input))) as T;
}

async function importJwk(jwk: AccessJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true } as any,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function loadJwks(c: Context<{ Bindings: Env; Variables: AdminVariables }>): Promise<AccessJwks> {
  // KV is the best cache here: it survives isolate eviction so a hot path
  // never hits the team domain. Falls back to in-memory on a miss if KV is
  // unbound (dev) or if the KV read errors.
  const kv = c.env.CONFIG_KV;
  if (kv && typeof kv.get === 'function') {
    try {
      const cached = await kv.get(JWKS_CACHE_KEY, 'json');
      if (cached) return cached as AccessJwks;
    } catch (err) {
      console.warn('[zeroTrust] KV JWKS read failed, falling through to fetch:', err);
    }
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  if (!teamDomain) throw new Error('ACCESS_TEAM_DOMAIN is not configured');
  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`JWKS fetch returned ${res.status}`);
  const jwks = (await res.json()) as AccessJwks;

  if (kv && typeof kv.put === 'function') {
    try {
      await kv.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('[zeroTrust] KV JWKS write failed, continuing:', err);
    }
  }
  return jwks;
}

interface AccessClaims {
  email: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  iss?: string;
  sub?: string;
}

async function verifyCFAuthCookie(
  c: Context<{ Bindings: Env; Variables: AdminVariables }>,
  cookieValue: string
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed JWT' };
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let claims: AccessClaims;
  try {
    header = base64UrlDecodeJson<{ kid?: string; alg?: string }>(headerB64);
    claims = base64UrlDecodeJson<AccessClaims>(payloadB64);
  } catch {
    return { ok: false, reason: 'undecodable JWT' };
  }
  if (!header.kid) return { ok: false, reason: 'missing kid' };
  if (header.alg && header.alg !== 'RS256') return { ok: false, reason: 'unsupported alg' };

  let jwks: AccessJwks;
  try {
    jwks = await loadJwks(c);
  } catch (err) {
    console.error('[zeroTrust] JWKS load failed:', err);
    return { ok: false, reason: 'JWKS unavailable' };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown kid' };

  const key = await importJwk(jwk);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlDecode(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!ok) return { ok: false, reason: 'signature mismatch' };

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now) return { ok: false, reason: 'expired' };

  if (c.env.ACCESS_AUD) {
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(c.env.ACCESS_AUD)) return { ok: false, reason: 'aud mismatch' };
  }
  if (!claims.email) return { ok: false, reason: 'no email claim' };
  return { ok: true, email: claims.email };
}

/**
 * Zero Trust Access & Admin Auth Middleware
 * Accepts, in order:
 *   1. Cf-Access-Jwt-Assertion + Cf-Access-Authenticated-User-Email headers
 *      (same-host Access application — zero round-trips on the happy path).
 *   2. A verified CF_Authorization cookie (cross-origin SPA → API, when
 *      ACCESS_TEAM_DOMAIN + ACCESS_AUD are configured).
 *   3. Bearer ADMIN_TOKEN — trusted in any environment when ADMIN_TOKEN
 *      is configured. Used by the admin SPA on first deploy (before the
 *      user has a Cloudflare Access session) and by any admin tooling.
 *   4. In non-production with no ADMIN_TOKEN set, an open dev bypass.
 *   5. Otherwise: 401.
 *
 * The Access paths (1 and 2) only fire if a real Access application is
 * configured to gate the SPA/API. If you don't have one, only paths 3, 4,
 * 5 apply — and you must set ADMIN_TOKEN as a Wrangler secret in
 * production, or every /api/admin/* call will 401.
 */
export async function zeroTrustAdminGuard(c: Context<{ Bindings: Env; Variables: AdminVariables }>, next: Next) {
  const cfEmail = c.req.header('Cf-Access-Authenticated-User-Email');
  const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');
  const authHeader = c.req.header('Authorization');

  const actorEmail = cfEmail || 'admin-local@dailyroast.in';
  const actorId = 'actor_admin_01';
  const isProduction = c.env.ENVIRONMENT === 'production';

  // Primary path: Cloudflare Access has already verified the user and forwarded a signed JWT.
  if (cfJwt && cfEmail) {
    c.set('adminActor' as any, {
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
        c.set('adminActor' as any, {
          id: 'zt_' + result.email,
          email: result.email,
          role: 'ADMIN',
        });
        return next();
      }
      console.warn('[zeroTrust] CF_Authorization cookie rejected:', result.reason);
    }
  }

  // Bearer ADMIN_TOKEN — works in any environment when ADMIN_TOKEN is set.
  // This is the production fallback when Cloudflare Access isn't gating the
  // SPA/API at the edge. The token never leaves the admin SPA bundle (it's
  // fetched at build time from a Wrangler secret in CI) and is sent on every
  // /api/admin/* request via the adminFetch helper. Rotate by re-deploying.
  if (authHeader && authHeader.startsWith('Bearer ') && c.env.ADMIN_TOKEN) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === c.env.ADMIN_TOKEN) {
      c.set('adminActor' as any, {
        id: 'actor_admin_01',
        email: actorEmail,
        role: 'ADMIN',
      });
      return next();
    }
  }

  // Non-production with no ADMIN_TOKEN configured at all: allow through for local dev only.
  if (!isProduction && !c.env.ADMIN_TOKEN) {
    c.set('adminActor' as any, {
      id: 'local_dev_admin',
      email: 'roaster@dailyroast.in',
      role: 'ADMIN',
    });
    return next();
  }

  return c.json({
    success: false,
    error: 'Access Denied: admin route requires a valid session, CF_Authorization cookie (when ACCESS_TEAM_DOMAIN is set), or ADMIN_TOKEN bearer.',
  }, 401);
}

/**
 * Audit Logging Helper
 * Writes privileged admin changes to D1 audit_log
 */
export async function recordAuditLog(
  db: any,
  actor: { id: string; email: string },
  action: string,
  entityType: string,
  entityId: string,
  oldVal?: any,
  newVal?: any,
  ip?: string
) {
  const id = 'aud_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await db.prepare(`
    INSERT INTO audit_log (
      id, actor_id, actor_email, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    id,
    actor.id,
    actor.email,
    action,
    entityType,
    entityId,
    oldVal ? JSON.stringify(oldVal) : null,
    newVal ? JSON.stringify(newVal) : null,
    ip || null
  ).run();
}
