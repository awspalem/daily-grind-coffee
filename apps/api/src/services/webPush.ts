/**
 * Minimal Web Push (RFC 8030) sender for the PWA service worker.
 *
 * Scope, deliberately: this sends **no-payload** pushes. The Authorization header is a signed
 * VAPID JWT (RFC 8292); the body is empty. On receipt the service worker's `push` handler fetches
 * the notification content from the API itself. This skips RFC 8291 payload encryption
 * (ECDH + HKDF + aes128gcm) entirely — that path is hard to verify without a real browser
 * subscription and is not worth the risk for the handful of notification types we send. The
 * `p256dh` / `auth` keys are still stored (see migration 0030) so encrypted payloads can be
 * added later without a schema change.
 *
 * Configuration (all three required for sends; absent any one, send() is a logged no-op the same
 * way ResendEmailService behaves without an API key):
 *
 *   VAPID_PUBLIC_KEY   — base64url, uncompressed P-256 point (65 bytes). Also served to the
 *                        browser by GET /api/customer/push/vapid-key.
 *   VAPID_PRIVATE_JWK  — the matching private key as a JWK JSON string ({"kty":"EC","crv":"P-256",...}).
 *                        JWK rather than raw because Web Crypto imports it directly.
 *   VAPID_SUBJECT      — "mailto:ops@dailyroast.in" or an https: URL. Identifies the sender to
 *                        the push service.
 *
 * Generate a keypair once with:
 *   node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']).then(async k=>{const pub=Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64url');const jwk=await crypto.subtle.exportKey('jwk',k.privateKey);console.log('VAPID_PUBLIC_KEY='+pub);console.log('VAPID_PRIVATE_JWK='+JSON.stringify(jwk));})"
 * then `wrangler secret put VAPID_PRIVATE_JWK` (and add VAPID_PUBLIC_KEY / VAPID_SUBJECT as vars).
 */

import type { Env } from '../types/env';

export interface PushConfig {
  publicKey: string;
  privateJwk: string;
  subject: string;
}

/** Returns the push config iff all three values are present. */
export function pushConfigFromEnv(env: Env): PushConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateJwk: env.VAPID_PRIVATE_JWK,
    subject: env.VAPID_SUBJECT,
  };
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Origin (scheme + host) of a push endpoint — the JWT `aud`. */
function audienceOf(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

/**
 * Builds the `Authorization: vapid t=<jwt>, k=<pubkey>` header value for one push endpoint.
 * The JWT is ES256-signed and valid for 12 hours (the RFC 8292 ceiling is 24h).
 */
async function vapidAuthHeader(cfg: PushConfig, endpoint: string): Promise<string> {
  const jwk = JSON.parse(cfg.privateJwk);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    aud: audienceOf(endpoint),
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: cfg.subject,
  })));
  const signingInput = `${header}.${payload}`;

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  // Web Crypto returns the raw r||s pair, which is exactly the JWS ES256 encoding.
  const jwt = `${signingInput}.${base64url(sig)}`;
  return `vapid t=${jwt}, k=${cfg.publicKey}`;
}

export interface PushSendResult {
  ok: boolean;
  /** The push service says this subscription no longer exists — the caller should prune it. */
  gone: boolean;
  status?: number;
  error?: string;
}

/**
 * Sends one no-payload push. `endpoint` is the subscription's push-service URL.
 * A 201/200/202 is success; 404/410 means the subscription is dead; anything else is a
 * transient failure the caller can retry next sweep.
 */
export async function sendPush(cfg: PushConfig, endpoint: string, ttlSeconds = 2419200): Promise<PushSendResult> {
  let auth: string;
  try {
    auth = await vapidAuthHeader(cfg, endpoint);
  } catch (err: any) {
    return { ok: false, gone: false, error: `VAPID signing failed: ${err?.message || err}` };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        TTL: String(ttlSeconds),
        'Content-Length': '0',
      },
    });
    if (res.ok) return { ok: true, gone: false, status: res.status };
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
    return { ok: false, gone: false, status: res.status, error: await res.text().catch(() => '') };
  } catch (err: any) {
    return { ok: false, gone: false, error: err?.message || 'network error' };
  }
}

/**
 * Fan a no-payload push out to every subscription belonging to a customer, pruning any the push
 * service reports as gone. Returns how many were delivered. A logged no-op when push is not
 * configured. Safe to call from a request handler or the cron.
 */
export async function pushToCustomer(env: Env, customerId: string): Promise<number> {
  const cfg = pushConfigFromEnv(env);
  if (!cfg) {
    console.warn('[Push] VAPID not configured — skipping push to customer', customerId);
    return 0;
  }

  const { results } = await env.DB.prepare(
    'SELECT id, endpoint FROM push_subscriptions WHERE customer_id = ?'
  ).bind(customerId).all<{ id: string; endpoint: string }>();

  let delivered = 0;
  for (const sub of results || []) {
    const r = await sendPush(cfg, sub.endpoint);
    if (r.ok) {
      delivered++;
      await env.DB.prepare('UPDATE push_subscriptions SET failure_count = 0, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(sub.id).run();
    } else if (r.gone) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
    } else {
      // Prune after repeated soft failures so a permanently broken endpoint doesn't linger.
      await env.DB.prepare(
        "DELETE FROM push_subscriptions WHERE id = ? AND failure_count >= 4"
      ).bind(sub.id).run();
      await env.DB.prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?')
        .bind(sub.id).run();
    }
  }
  return delivered;
}
