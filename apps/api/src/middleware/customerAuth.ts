import type { Env } from '../types/env';

export interface CustomerSession {
  customerId: string;
  email: string;
}

export type SessionLookup =
  | { kind: 'ok'; session: CustomerSession }
  | { kind: 'missing' }
  | { kind: 'expired' };

/**
 * Resolves the `X-Customer-Session` token into a customer, or null if the token is missing,
 * unknown or expired. Extracted from routes/customer.ts so every customer-facing route
 * (profile, loyalty, referral, subscriptions, bookings) authenticates identically.
 */
export async function resolveCustomerSession(
  db: Env['DB'],
  token: string | undefined
): Promise<CustomerSession | null> {
  const result = await lookupCustomerSession(db, token);
  return result.kind === 'ok' ? result.session : null;
}

/**
 * Same as `resolveCustomerSession` but distinguishes "no token sent" (caller never signed in) from
 * "token was valid but has expired" so the route can reply with `SESSION_EXPIRED`. The SPA uses
 * that to prompt a re-login rather than silently dropping the request.
 */
export async function lookupCustomerSession(
  db: Env['DB'],
  token: string | undefined
): Promise<SessionLookup> {
  if (!token) return { kind: 'missing' };

  const session = await db
    .prepare('SELECT customer_id, expires_at FROM customer_sessions WHERE token = ?')
    .bind(token)
    .first<{ customer_id: string; expires_at: string }>();
  if (!session) return { kind: 'expired' };

  if (!isFutureIso(session.expires_at)) return { kind: 'expired' };

  const customer = await db
    .prepare('SELECT id, email FROM customers WHERE id = ?')
    .bind(session.customer_id)
    .first<{ id: string; email: string }>();
  if (!customer) return { kind: 'expired' };

  return { kind: 'ok', session: { customerId: customer.id, email: customer.email } };
}

function isFutureIso(iso: string): boolean {
  const ts = Date.parse(iso);
  return Number.isFinite(ts) && ts > Date.now();
}

/** Shorthand for the standard 401 body used across customer routes. */
export const UNAUTHENTICATED = { success: false, error: 'Not authenticated' } as const;

/** Returned when a valid-looking token has expired. SPA triggers a re-login. */
export const SESSION_EXPIRED = { success: false, error: 'SESSION_EXPIRED', code: 'SESSION_EXPIRED' } as const;
