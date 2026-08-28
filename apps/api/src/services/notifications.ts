/**
 * Optional-notification plumbing: per-channel consent, and the back-in-stock sweep.
 *
 * The hard rule this module exists to enforce: **transactional mail never consults consent.**
 * Login codes, order confirmations, booking lifecycle mail and renewal notices go out
 * unconditionally — they are not marketing and a customer cannot opt out of being told their
 * order shipped. Consent (`customer_channel_consent`, migration 0030) governs only the optional
 * channels below, and the check lives at the *caller* of an optional send, not inside
 * ResendEmailService or the booking mailer.
 */

import type { Env } from '../types/env';
import { ResendEmailService } from './resend';
import { generateBackInStockEmail } from './emailTemplate';
import { pushToCustomer } from './webPush';

export type OptionalChannel = 'marketing_email' | 'product_news' | 'back_in_stock' | 'push';

export const OPTIONAL_CHANNELS: OptionalChannel[] = [
  'marketing_email',
  'product_news',
  'back_in_stock',
  'push',
];

/**
 * What a channel does when the customer has never touched their preferences.
 *
 *   marketing_email / product_news — opt-OUT: silent until the customer asks in.
 *   back_in_stock — opt-IN by action: joining a waitlist is itself the consent, so the default
 *                   is "on" and a row only ever exists to suppress.
 *   push — opt-IN by action: registering a subscription is the consent; same shape as above.
 */
const CHANNEL_DEFAULT_OPTED_IN: Record<OptionalChannel, boolean> = {
  marketing_email: false,
  product_news: false,
  back_in_stock: true,
  push: true,
};

function isOptionalChannel(x: string): x is OptionalChannel {
  return (OPTIONAL_CHANNELS as string[]).includes(x);
}

/** True if `customerId` may be sent on `channel`. No row → the channel's default. */
export async function hasConsent(env: Env, customerId: string, channel: OptionalChannel): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT opted_in FROM customer_channel_consent WHERE customer_id = ? AND channel = ?'
  ).bind(customerId, channel).first<{ opted_in: number }>();
  if (!row) return CHANNEL_DEFAULT_OPTED_IN[channel];
  return Number(row.opted_in) === 1;
}

/** The full preference map for a customer, defaults filled in — used by the GET endpoint. */
export async function getConsentMap(env: Env, customerId: string): Promise<Record<OptionalChannel, boolean>> {
  const { results } = await env.DB.prepare(
    'SELECT channel, opted_in FROM customer_channel_consent WHERE customer_id = ?'
  ).bind(customerId).all<{ channel: string; opted_in: number }>();

  const map = { ...CHANNEL_DEFAULT_OPTED_IN };
  for (const r of results || []) {
    if (isOptionalChannel(r.channel)) map[r.channel] = Number(r.opted_in) === 1;
  }
  return map;
}

/** Upsert one channel preference. Ignores unknown channel names. */
export async function setConsent(
  env: Env,
  customerId: string,
  channel: string,
  optedIn: boolean
): Promise<boolean> {
  if (!isOptionalChannel(channel)) return false;
  await env.DB.prepare(`
    INSERT INTO customer_channel_consent (customer_id, channel, opted_in, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(customer_id, channel) DO UPDATE SET
      opted_in = excluded.opted_in,
      updated_at = CURRENT_TIMESTAMP
  `).bind(customerId, channel, optedIn ? 1 : 0).run();
  return true;
}

// ---------------------------------------------------------------------------
// Back-in-stock sweep
// ---------------------------------------------------------------------------

interface PendingStockNotification {
  id: string;
  email: string;
  customer_id: string | null;
  product_name: string;
  product_slug: string;
  weight_grams: number;
}

function variantLabel(weightGrams: number): string {
  return weightGrams >= 1000 ? `${weightGrams / 1000}kg bag` : `${weightGrams}g bag`;
}

/**
 * Emails everyone waiting on a variant that is back above zero, one message per person per
 * restock, then stamps `notified_at` so they are not told again until they re-join the list.
 *
 * This polls rather than hooking the inventory ledger write: the ledger service has no access to
 * `Env` (so no Resend key, no push config), and a delayed sweep is fine for "back in stock" — the
 * same trade-off the booking reminders make. Runs on the hourly cron.
 *
 * Returns the number of notifications sent.
 */
export async function notifyBackInStock(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT sn.id, sn.email, sn.customer_id,
           p.name AS product_name, p.slug AS product_slug,
           v.weight_grams
    FROM stock_notifications sn
    JOIN inventory i        ON i.variant_id = sn.variant_id
    JOIN product_variants v ON v.id = sn.variant_id
    JOIN products p         ON p.id = v.product_id
    WHERE sn.notified_at IS NULL
      AND i.available_stock > 0
    LIMIT 200
  `).all<PendingStockNotification>();

  const pending = results || [];
  if (!pending.length) return 0;

  const mailer = new ResendEmailService(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  const storefront = env.STOREFRONT_URL || 'https://dailyroast.in';
  let sent = 0;

  for (const row of pending) {
    // A known customer who has explicitly turned back-in-stock off is skipped, but the row is
    // still stamped so it doesn't sit in the sweep forever.
    let suppressed = false;
    if (row.customer_id) {
      suppressed = !(await hasConsent(env, row.customer_id, 'back_in_stock'));
    }

    if (!suppressed) {
      const email = generateBackInStockEmail({
        customerEmail: row.email,
        productName: row.product_name,
        variantLabel: variantLabel(Number(row.weight_grams)),
        productUrl: `${storefront}/?product=${encodeURIComponent(row.product_slug)}#catalog`,
      });
      const res = await mailer.send(email.to, email.subject, email.html);
      if (!res.success) continue; // leave notified_at NULL — retried next sweep

      if (row.customer_id && (await hasConsent(env, row.customer_id, 'push'))) {
        await pushToCustomer(env, row.customer_id).catch(() => 0);
      }
      sent++;
    }

    await env.DB.prepare('UPDATE stock_notifications SET notified_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(row.id).run();
  }

  if (sent > 0) console.log(`[NOTIFY back-in-stock] sent ${sent}`);
  return sent;
}
