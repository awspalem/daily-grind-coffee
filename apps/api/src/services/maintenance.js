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
