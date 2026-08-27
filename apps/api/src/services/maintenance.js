/**
 * Periodic maintenance for the entitlement, booking and plan features.
 *
 * These jobs are separated from the nightly block in index.ts because they are time-sensitive in
 * a way a once-a-day run cannot serve: a booking hold that outlives its window keeps a seat off
 * the market, and a T-1h reminder sent at 4am is not a reminder. They run on the hourly cron.
 *
 * Every job is individually try/caught. One failing job must never stop the rest — a Cron
 * Trigger that throws is simply not retried until the next tick, so an unguarded failure here
 * would silently suspend seat release and reminders for an hour.
 */
import { expireStaleGrants } from './entitlements';
import { expireStaleHolds, reconcilePendingPayments, sendDueReminders, } from './bookings';
import { processPrepaidShipments, sendUpcomingRenewalNotices, } from './subscriptionPlans';
import { WorkersAIService } from './workersAI';
const EMBEDDING_BATCH_SIZE = 25;
// Re-embed a product if its stored vector is older than this. The bar is
// intentionally high — coffee catalog copy doesn't change weekly, and each
// re-embed is a Workers AI neuron call.
const EMBEDDING_MAX_AGE_DAYS = 30;
async function guard(label, fn, fallback) {
    try {
        return await fn();
    }
    catch (err) {
        console.error(`[MAINTENANCE ${label} ERROR]`, err);
        return fallback;
    }
}
/**
 * Runs on every cron tick (hourly). Cheap and idempotent — each underlying job is a no-op when
 * there is nothing due, so running it more often than needed costs a handful of indexed reads.
 */
export async function runHourlyMaintenance(env) {
    // Holds first: releasing an abandoned hold frees the seat *before* the waitlist promotion
    // that reconcilePendingPayments and the booking routes go on to look at.
    const holdsExpired = await guard('BOOKING_HOLDS', () => expireStaleHolds(env), 0);
    const settled = await guard('BOOKING_RECONCILE', () => reconcilePendingPayments(env), { confirmed: 0, released: 0 });
    // T-24h and T-1h both fall out of a 24-hour horizon scanned hourly; sendDueReminders keys each
    // send so a booking is never reminded twice for the same milestone.
    const remindersSent = await guard('BOOKING_REMINDERS', () => sendDueReminders(env, 24), 0);
    // Grants expire on their own schedule rather than lazily, because a lapsed grant must stop
    // funding bookings the moment it lapses — not the next time its owner happens to log in.
    const grantsExpired = await guard('ENTITLEMENT_EXPIRY', () => expireStaleGrants(env.DB), 0);
    // Backfill product embeddings for the Maya semantic-search tool. Runs hourly
    // and caps each tick at a small batch so a freshly deployed catalog doesn't
    // queue a single huge Workers AI burst on the first hour.
    await guard('PRODUCT_EMBEDDINGS', () => backfillProductEmbeddings(env), 0);
    // Roll up yesterday's dashboard stats. The hourly cron fires at the top of
    // every hour, so the first run after 00:00 UTC (~05:30 IST) covers the
    // previous full IST day. Today's row stays empty until tomorrow's tick —
    // the dashboard read falls back to a live aggregate for the current day.
    await guard('DASHBOARD_STATS', () => rollupDashboardStats(env), null);
    const report = {
        grantsExpired,
        holdsExpired,
        remindersSent,
        bookingsConfirmed: settled.confirmed,
        bookingsReleased: settled.released,
    };
    const touched = Object.values(report).some((n) => n > 0);
    if (touched)
        console.log('[MAINTENANCE hourly]', report);
    return report;
}
/**
 * Runs once a day, alongside the nightly block. Both jobs send email, so they are deliberately
 * kept off the hourly tick.
 */
export async function runDailyPlanMaintenance(env) {
    await guard('RENEWAL_NOTICES', () => sendUpcomingRenewalNotices(env, 3), 0);
    await guard('PREPAID_SHIPMENTS', () => processPrepaidShipments(env), { shipped: 0, exhausted: 0 });
}
/**
 * Embeds products that are missing a vector or whose vector is older than
 * EMBEDDING_MAX_AGE_DAYS, in batches of EMBEDDING_BATCH_SIZE per hourly
 * tick. Products without a tagline/description fall back to a name-only
 * embed — better a sparse vector than no vector.
 *
 * Returns the number of products embedded in this tick (used only for the
 * guard's "did anything happen?" log line, not surfaced anywhere).
 */
async function backfillProductEmbeddings(env) {
    if (!env.AI)
        return 0;
    const cutoffIso = new Date(Date.now() - EMBEDDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { results } = await env.DB.prepare(`
    SELECT id, name, tagline, description, tasting_notes, roast_level, origin_country
    FROM products
    WHERE is_active = 1
      AND (embedding_json IS NULL
           OR embedding_updated_at IS NULL
           OR embedding_updated_at < ?)
    ORDER BY embedding_updated_at IS NOT NULL, embedding_updated_at ASC
    LIMIT ?
  `).bind(cutoffIso, EMBEDDING_BATCH_SIZE).all();
    if (!results || !results.length)
        return 0;
    const ai = new WorkersAIService(env.AI);
    let embedded = 0;
    for (const p of results) {
        try {
            const text = [
                p.name,
                p.tagline,
                p.description,
                Array.isArray(p.tasting_notes) ? p.tasting_notes.join(' ') : (p.tasting_notes || ''),
                p.roast_level,
                p.origin_country,
            ].filter(Boolean).join(' ');
            const vector = await ai.generateEmbedding(text);
            await env.DB.prepare(`
        UPDATE products
        SET embedding_json = ?, embedding_model = 'bge-base-en-v1.5', embedding_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(JSON.stringify(vector), p.id).run();
            embedded++;
        }
        catch (err) {
            console.error(`[PRODUCT_EMBEDDINGS] failed to embed product ${p.id}:`, err);
        }
    }
    if (embedded > 0)
        console.log(`[PRODUCT_EMBEDDINGS] embedded ${embedded} product(s) this tick`);
    return embedded;
}
/**
 * Roll up the previous IST day's orders into dashboard_stats. Idempotent —
 * safe to re-run: the bucket_date PRIMARY KEY upserts the same row.
 *
 * Computes in one batch (five aggregate queries) and one INSERT OR REPLACE.
 * Skipped when there's no order activity so the table doesn't fill with
 * zero rows for the days the shop was closed.
 */
async function rollupDashboardStats(env) {
    // IST is UTC+5:30, so "yesterday IST" = the 24h window starting 30 hours
    // ago UTC and ending 6 hours ago UTC. Use the calendar date in IST.
    const nowUtcMs = Date.now();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(nowUtcMs + istOffsetMs);
    const yesterday = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
    const bucketDate = yesterday.toISOString().slice(0, 10);
    // Window: 00:00:00 IST to 23:59:59 IST of `bucketDate` → in UTC, that's
    // the previous day's 18:30 to this day's 18:29.
    const startUtc = new Date(`${bucketDate}T00:00:00+05:30`).toISOString();
    const endUtc = new Date(`${bucketDate}T23:59:59+05:30`).toISOString();
    const { results: orderAggs } = await env.DB.prepare(`
    SELECT
      COUNT(*) as orders_total,
      SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as orders_paid,
      SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) as orders_pending,
      SUM(CASE WHEN status IN ('CANCELLED', 'REFUNDED') THEN 1 ELSE 0 END) as orders_cancelled,
      COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_cents ELSE 0 END), 0) as revenue_cents_total,
      COALESCE(AVG(CASE WHEN status = 'PAID' THEN total_cents ELSE NULL END), 0) as avg_order_cents
    FROM orders
    WHERE created_at >= ? AND created_at < ?
  `).bind(startUtc, endUtc).all();
    const agg = (orderAggs && orderAggs[0]) || {};
    if (!agg.orders_total)
        return null; // nothing to roll up that day
    const { results: statusRows } = await env.DB.prepare(`
    SELECT status, COUNT(*) as n
    FROM orders
    WHERE created_at >= ? AND created_at < ?
    GROUP BY status
  `).bind(startUtc, endUtc).all();
    const statusBreakdown = {};
    for (const r of statusRows || [])
        statusBreakdown[r.status] = Number(r.n);
    const inv = await env.DB.prepare(`
    SELECT COALESCE(SUM(available_stock + reserved_stock), 0) as n
    FROM inventory
  `).first();
    await env.DB.prepare(`
    INSERT INTO dashboard_stats (
      bucket_date, orders_total, orders_paid, orders_pending, orders_cancelled,
      revenue_cents_total, avg_order_cents, inventory_units_total,
      status_breakdown_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_date) DO UPDATE SET
      orders_total = excluded.orders_total,
      orders_paid = excluded.orders_paid,
      orders_pending = excluded.orders_pending,
      orders_cancelled = excluded.orders_cancelled,
      revenue_cents_total = excluded.revenue_cents_total,
      avg_order_cents = excluded.avg_order_cents,
      inventory_units_total = excluded.inventory_units_total,
      status_breakdown_json = excluded.status_breakdown_json,
      updated_at = CURRENT_TIMESTAMP
  `).bind(bucketDate, Number(agg.orders_total || 0), Number(agg.orders_paid || 0), Number(agg.orders_pending || 0), Number(agg.orders_cancelled || 0), Number(agg.revenue_cents_total || 0), Math.round(Number(agg.avg_order_cents || 0)), Number(inv?.n || 0), JSON.stringify(statusBreakdown)).run();
    return { rolledUp: bucketDate };
}
