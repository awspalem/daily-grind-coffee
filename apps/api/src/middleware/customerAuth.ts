import type { Env } from '../types/env';

export interface CustomerSession {
  customerId: string;
  email: string;
}

/**
 * Resolves the `X-Customer-Session` token into a customer, or null if the token is missing,
 * unknown or expired. Extracted from routes/customer.ts so every customer-facing route
 * (profile, loyalty, referral, subscriptions, bookings) authenticates identically.
 */
export async function resolveCustomerSession(
  db: Env['DB'],
  token: string | undefined
): Promise<CustomerSession | null> {
  if (!token) return null;

  const session = await db
    .prepare('SELECT customer_id FROM customer_sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP')
    .bind(token)
    .first<{ customer_id: string }>();
  if (!session) return null;

  const customer = await db
    .prepare('SELECT id, email FROM customers WHERE id = ?')
    .bind(session.customer_id)
    .first<{ id: string; email: string }>();
  if (!customer) return null;

  return { customerId: customer.id, email: customer.email };
}

/** Shorthand for the standard 401 body used across customer routes. */
export const UNAUTHENTICATED = { success: false, error: 'Not authenticated' } as const;
