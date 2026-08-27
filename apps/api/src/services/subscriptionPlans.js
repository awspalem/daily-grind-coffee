import { grantEntitlement, listActiveGrants } from './entitlements';
import { ResendEmailService } from './resend';
/**
 * Subscription plans, tiers and self-serve lifecycle (Phase 4).
 *
 * Everything about a plan that isn't an HTTP concern lives here: the catalog, the entitlement
 * grants a plan issues, the state machine behind pause/skip/cancel, and the two jobs the
 * renewal cron ought to call. It is a service rather than route code specifically because
 * `apps/api/src/index.ts` (the cron) is owned by another workstream — the cron can adopt
 * `processPrepaidShipments` and `sendUpcomingRenewalNotices` with a one-line call each.
 */
export const FREQUENCY_DAYS = {
    '1_WEEK': 7,
    '2_WEEKS': 14,
    '4_WEEKS': 28,
};
export const GRIND_TYPES = [
    'WHOLE_BEAN', 'ESPRESSO', 'POUR_OVER', 'AEROPRESS', 'DRIP', 'FRENCH_PRESS', 'COLD_BREW',
];
export function newId(prefix) {
    return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
function safeJson(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
/** Formats paise as rupees. The storefront's shared `formatCents` is hardcoded to USD. */
export function formatInr(cents) {
    return '₹' + Math.round((cents || 0) / 100).toLocaleString('en-IN');
}
export function addDays(from, days) {
    const base = from instanceof Date ? from : new Date(from);
    return new Date(base.getTime() + days * 86400000).toISOString();
}
export function addMonths(from, months) {
    const base = from instanceof Date ? new Date(from) : new Date(from);
    base.setUTCMonth(base.getUTCMonth() + months);
    return base.toISOString();
}
// ==================== Catalog ====================
export function serialisePlan(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tier: row.tier,
        term: row.term,
        tagline: row.tagline,
        description: row.description,
        price_cents: row.price_cents,
        currency: row.currency,
        discount_percent: row.discount_percent,
        default_frequency: row.default_frequency,
        shipments_included: row.shipments_included,
        term_months: row.term_months,
        perks: safeJson(row.perks_json, []),
        entitlements: safeJson(row.entitlements_json, []),
        badge: row.badge,
        display_order: row.display_order,
        is_active: !!row.is_active,
    };
}
export async function listPlans(db, includeInactive = false) {
    const sql = `
    SELECT * FROM subscription_plans
    ${includeInactive ? '' : 'WHERE is_active = 1'}
    ORDER BY display_order ASC, price_cents ASC
  `;
    const { results } = await db.prepare(sql).all();
    return (results || []);
}
export async function getPlan(db, idOrSlug) {
    return await db
        .prepare('SELECT * FROM subscription_plans WHERE id = ? OR slug = ?')
        .bind(idOrSlug, idOrSlug)
        .first();
}
// ==================== Event log ====================
export async function recordSubscriptionEvent(db, subscriptionId, eventType, actor, detail) {
    await db
        .prepare(`
      INSERT INTO subscription_events (id, subscription_id, event_type, actor, detail_json)
      VALUES (?, ?, ?, ?, ?)
    `)
        .bind(newId('sube'), subscriptionId, eventType, actor, detail ? JSON.stringify(detail) : null)
        .run();
}
// ==================== Ownership ====================
/**
 * Loads a subscription only if it belongs to the caller.
 *
 * `subscriptions.customer_id` is nullable and the table's historical key is `customer_email`
 * (rows created before customer accounts existed have no id), so ownership has to accept the
 * email match too — but only for rows with no customer_id, otherwise one customer could reach
 * another's subscription by sharing an address. Both values come from the resolved session,
 * never from the request.
 */
export async function findOwnedSubscription(db, subscriptionId, session) {
    return await db
        .prepare(`
      SELECT * FROM subscriptions
      WHERE id = ?
        AND (customer_id = ? OR (customer_id IS NULL AND LOWER(customer_email) = LOWER(?)))
    `)
        .bind(subscriptionId, session.customerId, session.email)
        .first();
}
export async function listOwnedSubscriptions(db, session) {
    const { results } = await db
        .prepare(`
      SELECT * FROM subscriptions
      WHERE customer_id = ? OR (customer_id IS NULL AND LOWER(customer_email) = LOWER(?))
      ORDER BY CASE status
                 WHEN 'PAST_DUE' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'PREPAID' THEN 2
                 WHEN 'PAUSED' THEN 3 ELSE 4 END,
               next_renewal_date ASC
    `)
        .bind(session.customerId, session.email)
        .all();
    return (results || []);
}
export async function serialiseSubscription(db, sub) {
    const plan = sub.plan_id ? await getPlan(db, sub.plan_id) : null;
    return {
        id: sub.id,
        customer_email: sub.customer_email,
        plan_id: sub.plan_id,
        plan_name: plan?.name ?? null,
        plan_tier: plan?.tier ?? null,
        plan_term: sub.plan_term ?? plan?.term ?? null,
        plan_perks: plan ? safeJson(plan.perks_json, []) : [],
        variant_id: sub.variant_id,
        product_name: sub.product_name,
        grind_type: sub.grind_type,
        frequency: sub.frequency,
        quantity: sub.quantity,
        unit_price_cents: sub.unit_price_cents,
        discount_percent: sub.discount_percent,
        status: sub.status,
        next_renewal_date: sub.next_renewal_date,
        term_started_at: sub.term_started_at,
        term_ends_at: sub.term_ends_at,
        shipments_remaining: sub.shipments_remaining,
        paused_at: sub.paused_at,
        cancelled_at: sub.cancelled_at,
        // The card number itself never leaves Stripe; the UI only needs to know whether the dunning
        // banner should offer a "fix payment method" button.
        has_payment_method: !!(sub.stripe_customer_id && sub.stripe_payment_method_id),
        shipping_address: safeJson(sub.shipping_address_json, null),
        created_at: sub.created_at,
    };
}
// ==================== Entitlement grants ====================
/**
 * Issues the plan's entitlement set for one term, idempotently.
 *
 * `grantEntitlement` has no idempotency key of its own and `onOrderPaid` can fire more than
 * once (a Stripe retry, or the same order arriving through two event types), so a naive grant
 * would hand out free consultations on every replay. The guard is the (source_type, source_id,
 * code, starts_at) tuple: one grant per code per term window per subscription.
 */
export async function grantPlanEntitlements(db, params) {
    const specs = safeJson(params.plan.entitlements_json, []);
    const granted = [];
    const skipped = [];
    for (const spec of specs) {
        if (!spec?.code || typeof spec.units !== 'number' || spec.units === 0)
            continue;
        const existing = await db
            .prepare(`
        SELECT id FROM entitlement_grants
        WHERE source_type = ? AND source_id = ? AND entitlement_code = ? AND starts_at = ?
          AND status != 'REVOKED'
      `)
            .bind(params.sourceType, params.subscriptionId, spec.code, params.startsAt)
            .first();
        if (existing) {
            skipped.push(spec.code);
            continue;
        }
        await grantEntitlement(db, {
            customerId: params.customerId,
            code: spec.code,
            totalUnits: spec.units,
            sourceType: params.sourceType,
            sourceId: params.subscriptionId,
            startsAt: params.startsAt,
            // Perks are good for the term they were bought with and no longer — an annual member's
            // two consultations don't stockpile into year two.
            expiresAt: params.expiresAt,
            notes: `${params.plan.name} (${params.plan.term})`,
        });
        granted.push(spec.code);
    }
    if (granted.length) {
        await recordSubscriptionEvent(db, params.subscriptionId, 'ENTITLEMENTS_GRANTED', 'SYSTEM', {
            plan: params.plan.slug,
            codes: granted,
            expires_at: params.expiresAt,
        });
    }
    return { granted, skipped };
}
/**
 * Revokes everything a subscription's plan issued. Used when the purchase is refunded.
 *
 * Deliberately not `releaseEntitlement` — that puts *units back into* a grant (a cancelled
 * booking); this kills the bucket outright. Already-consumed units stay consumed: the ledger is
 * an audit trail, and the booking those units paid for still happened.
 */
export async function revokePlanEntitlements(db, subscriptionId, reason) {
    const res = await db
        .prepare(`
      UPDATE entitlement_grants
      SET status = 'REVOKED',
          notes = COALESCE(notes, '') || ' | revoked: ' || ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ? AND source_type IN ('SUBSCRIPTION', 'PLAN_RENEWAL') AND status != 'REVOKED'
    `)
        .bind(reason, subscriptionId)
        .run();
    return res?.meta?.changes ?? 0;
}
/** The perks a customer can actually spend right now, for the account page's perks strip. */
export async function getPlanPerkBalances(db, customerId) {
    const grants = await listActiveGrants(db, customerId);
    return grants
        .filter((g) => g.source_type === 'SUBSCRIPTION' || g.source_type === 'PLAN_RENEWAL')
        .map((g) => ({
        entitlement_code: g.entitlement_code,
        unlimited: g.total_units === -1,
        remaining_units: g.total_units === -1 ? -1 : Math.max(0, g.total_units - g.used_units),
        expires_at: g.expires_at,
        source_id: g.source_id,
    }));
}
/**
 * Turns a paid-for plan subscription live. Called from the order-paid hook, never at checkout —
 * a row created for an abandoned Stripe session must never start billing or start a term clock.
 *
 * MONTHLY lands in ACTIVE so the existing renewal cron picks it up and charges each cycle at
 * the tier's discount. ANNUAL lands in PREPAID, which the cron's `WHERE status = 'ACTIVE'`
 * deliberately excludes: the year is already paid for and nothing should ever charge it again.
 */
export async function activatePlanSubscription(db, sub, plan, startsAt) {
    const days = FREQUENCY_DAYS[sub.frequency] ?? 14;
    const isAnnual = plan.term === 'ANNUAL';
    await db
        .prepare(`
      UPDATE subscriptions
      SET status = ?,
          next_renewal_date = ?,
          shipments_remaining = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'PENDING_PAYMENT'
    `)
        .bind(isAnnual ? 'PREPAID' : 'ACTIVE', 
    // Annual prepays the term, so the first bag is owed immediately; monthly's first bag was
    // part of this very charge, so the clock starts one cycle out.
    isAnnual ? startsAt : addDays(startsAt, days), isAnnual ? plan.shipments_included : null, sub.id)
        .run();
    // PENDING_PAYMENT -> ACTIVE/PREPAID is its own transition in the customer-facing timeline,
    // distinct from CREATED (which fires at checkout) and from any later renewal. Webhook replays
    // are guarded by the `status = 'PENDING_PAYMENT'` predicate on the UPDATE, so the event can be
    // written unconditionally after it.
    await recordSubscriptionEvent(db, sub.id, 'ACTIVATED', 'SYSTEM', {
        status: isAnnual ? 'PREPAID' : 'ACTIVE',
        plan: plan.slug,
        next_renewal_date: isAnnual ? startsAt : addDays(startsAt, days),
    });
}
// ==================== Upcoming shipments ====================
/**
 * The next few dates a subscription will ship on, and whether each one bills.
 *
 * Renewal transparency (4.4) is mostly this function: a subscriber should never be surprised by
 * a charge, so the account page shows the date, the amount and — for a prepaid term — that
 * nothing will be charged at all.
 */
export function projectUpcomingShipments(sub, count = 3) {
    if (sub.status === 'CANCELLED')
        return [];
    const days = FREQUENCY_DAYS[sub.frequency] ?? 14;
    const willCharge = sub.plan_term !== 'ANNUAL';
    const perShipment = Math.round(sub.unit_price_cents * (1 - sub.discount_percent / 100)) * sub.quantity;
    const shipments = [];
    let cursor = sub.next_renewal_date;
    const remaining = sub.shipments_remaining;
    for (let i = 0; i < count; i++) {
        if (remaining !== null && remaining !== undefined && i >= remaining)
            break;
        if (sub.term_ends_at && new Date(cursor) > new Date(sub.term_ends_at))
            break;
        shipments.push({
            subscription_id: sub.id,
            product_name: sub.product_name,
            grind_type: sub.grind_type,
            quantity: sub.quantity,
            scheduled_for: cursor,
            will_charge: willCharge,
            estimated_total_cents: willCharge ? perShipment : 0,
            // A paused subscription still has a projected schedule, but it is what *would* happen;
            // the UI labels it as on hold rather than hiding it.
            on_hold: sub.status === 'PAUSED',
        });
        cursor = addDays(cursor, days);
    }
    return shipments;
}
// ==================== Self-serve lifecycle ====================
export async function pauseSubscription(db, sub, actor = 'CUSTOMER') {
    await db
        .prepare(`
      UPDATE subscriptions
      SET status = 'PAUSED', paused_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'PAUSED', actor, { was: sub.status });
}
/**
 * Resuming restores the pre-pause status and pushes the next delivery out to a full cycle from
 * today. Without the reschedule, a subscription paused past its renewal date would bill the
 * instant it came back — which is exactly the surprise pausing was meant to avoid.
 */
export async function resumeSubscription(db, sub, actor = 'CUSTOMER') {
    const days = FREQUENCY_DAYS[sub.frequency] ?? 14;
    const restoredStatus = sub.plan_term === 'ANNUAL' ? 'PREPAID' : 'ACTIVE';
    const next = new Date(sub.next_renewal_date) > new Date()
        ? sub.next_renewal_date
        : addDays(new Date(), days);
    await db
        .prepare(`
      UPDATE subscriptions
      SET status = ?, paused_at = NULL, next_renewal_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(restoredStatus, next, sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'RESUMED', actor, { next_renewal_date: next });
    return next;
}
/**
 * Skipping is implemented by moving `next_renewal_date` forward one cycle, not by a skip flag.
 * The renewal cron selects purely on `status = 'ACTIVE' AND next_renewal_date <= now`, so a
 * flag it doesn't read would let the skipped delivery ship and bill anyway.
 */
export async function skipNextDelivery(db, sub, actor = 'CUSTOMER') {
    const days = FREQUENCY_DAYS[sub.frequency] ?? 14;
    const base = new Date(sub.next_renewal_date) > new Date() ? sub.next_renewal_date : new Date().toISOString();
    const next = addDays(base, days);
    await db
        .prepare(`
      UPDATE subscriptions
      SET next_renewal_date = ?,
          renewal_notice_sent_for = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(next, sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'SKIPPED', actor, {
        skipped: sub.next_renewal_date,
        next_renewal_date: next,
    });
    return next;
}
export async function updateSubscription(db, sub, input, actor = 'CUSTOMER') {
    const sets = [];
    const binds = [];
    const changed = {};
    if (input.grind_type !== undefined) {
        if (!GRIND_TYPES.includes(input.grind_type))
            return { ok: false, error: 'Unknown grind type' };
        sets.push('grind_type = ?');
        binds.push(input.grind_type);
        changed.grind_type = input.grind_type;
    }
    if (input.frequency !== undefined) {
        if (!FREQUENCY_DAYS[input.frequency])
            return { ok: false, error: 'Unknown delivery frequency' };
        sets.push('frequency = ?');
        binds.push(input.frequency);
        changed.frequency = input.frequency;
    }
    if (input.quantity !== undefined) {
        const qty = Math.trunc(Number(input.quantity));
        if (!Number.isFinite(qty) || qty < 1 || qty > 10)
            return { ok: false, error: 'Quantity must be between 1 and 10' };
        sets.push('quantity = ?');
        binds.push(qty);
        changed.quantity = qty;
    }
    if (input.shipping_address !== undefined) {
        sets.push('shipping_address_json = ?');
        binds.push(JSON.stringify(input.shipping_address));
        changed.shipping_address = true;
    }
    if (input.next_renewal_date !== undefined) {
        const when = new Date(input.next_renewal_date);
        if (Number.isNaN(when.getTime()))
            return { ok: false, error: 'Invalid delivery date' };
        // Never let a customer set a date in the past — the cron would bill it on its next run.
        if (when.getTime() < Date.now())
            return { ok: false, error: 'Pick a date in the future' };
        sets.push('next_renewal_date = ?', 'renewal_notice_sent_for = NULL');
        binds.push(when.toISOString());
        changed.next_renewal_date = when.toISOString();
    }
    if (!sets.length)
        return { ok: false, error: 'Nothing to update' };
    binds.push(sub.id);
    await db
        .prepare(`UPDATE subscriptions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...binds)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'UPDATED', actor, changed);
    return { ok: true };
}
/** Swaps the coffee. Price follows the new variant so the next renewal charges correctly. */
export async function swapCoffee(db, sub, variantId, actor = 'CUSTOMER') {
    const variant = await db
        .prepare(`
      SELECT v.id, v.price_cents, v.weight_grams, p.name AS product_name
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ? AND v.is_active = 1 AND p.is_active = 1
    `)
        .bind(variantId)
        .first();
    if (!variant)
        return { ok: false, error: 'That coffee is not available' };
    await db
        .prepare(`
      UPDATE subscriptions
      SET variant_id = ?, product_name = ?, unit_price_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(variant.id, variant.product_name, variant.price_cents, sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'SWAPPED', actor, {
        from: sub.product_name,
        to: variant.product_name,
    });
    return { ok: true, product_name: variant.product_name };
}
/**
 * What we offer before letting someone go. Tailored to the stated reason, and offered at most
 * once per subscription (`save_offer_used_at`) so it can't be farmed for repeat discounts.
 */
export function buildSaveOffer(sub, reason) {
    if (sub.save_offer_used_at)
        return null;
    const normalised = (reason || '').toUpperCase();
    if (normalised.includes('TOO_MUCH') || normalised.includes('TOO_OFTEN')) {
        return {
            kind: 'SLOWER_CADENCE',
            headline: 'Too much coffee? Stretch it out instead.',
            detail: 'We can move you to a delivery every 4 weeks and keep your tier and perks exactly as they are.',
        };
    }
    if (normalised.includes('PRICE') || normalised.includes('EXPENSIVE') || normalised.includes('COST')) {
        return {
            kind: 'DISCOUNT',
            headline: 'Stay on at 20% off for your next three deliveries.',
            detail: 'Same coffee, same schedule, a deeper discount while you decide.',
        };
    }
    return {
        kind: 'PAUSE',
        headline: 'Pause for up to 3 months instead of cancelling.',
        detail: 'Nothing is charged while you are paused, and your plan perks stay valid for the rest of your term.',
    };
}
export async function acceptSaveOffer(db, sub, kind) {
    if (sub.save_offer_used_at)
        return { ok: false, error: 'This offer has already been used' };
    if (kind === 'PAUSE') {
        await pauseSubscription(db, sub);
    }
    else if (kind === 'SLOWER_CADENCE') {
        await db
            .prepare(`
        UPDATE subscriptions
        SET frequency = '4_WEEKS', next_renewal_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(addDays(new Date(), 28), sub.id)
            .run();
    }
    else {
        // Bumped, not replaced: a Connoisseur on 15% goes to 20%, never down.
        await db
            .prepare(`
        UPDATE subscriptions
        SET discount_percent = MAX(discount_percent, 20), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(sub.id)
            .run();
    }
    await db
        .prepare('UPDATE subscriptions SET save_offer_used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'SAVE_OFFER_ACCEPTED', 'CUSTOMER', { kind });
    const message = kind === 'PAUSE'
        ? 'Paused. Resume any time from your account.'
        : kind === 'SLOWER_CADENCE'
            ? 'Moved to a delivery every 4 weeks.'
            : 'Your next deliveries are at 20% off.';
    return { ok: true, message };
}
export async function cancelSubscription(db, sub, reason, actor = 'CUSTOMER') {
    await db
        .prepare(`
      UPDATE subscriptions
      SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(reason || null, sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'CANCELLED', actor, { reason });
    // Entitlements are NOT revoked here. A cancelled annual member paid for the year, so the
    // consultations and tour seats stay spendable until the term window they were granted for
    // lapses on its own. Refunds are the case that revokes — see hooks/plans.ts.
}
/**
 * Computes the direction of a plan swap from one row to another. Pricing is the canonical signal:
 * a higher price is an upgrade, a lower one is a downgrade, equal prices are lateral (the same
 * tier at a different term or a different perk mix). This deliberately ignores the catalog
 * `display_order` column because pricing is what the customer was actually paying for.
 */
export function classifyPlanSwap(from, to) {
    if (from.id === to.id)
        return 'LATERAL';
    if (to.price_cents > from.price_cents)
        return 'UPGRADE';
    if (to.price_cents < from.price_cents)
        return 'DOWNGRADE';
    return 'LATERAL';
}
/**
 * Swaps a subscription to a different plan. The swap is:
 *   1. row metadata: plan_id, plan_term, discount_percent all follow the new plan immediately
 *   2. existing perks: kept spendable until they lapse on their own (downgrade) or replaced by
 *      a fresh grant at the next term boundary (upgrade). Already-consumed units stay consumed.
 *   3. renewal: the next renewal charges the new plan's price; the current cycle's price is
 *      unchanged (no mid-term proration — see the policy comment above).
 *
 * Returns a result that the route can surface to the customer; the customer-facing message is
 * the only consumer-facing difference between upgrade and downgrade.
 */
export async function swapPlan(db, sub, input) {
    const { fromPlan, toPlan, actor = 'CUSTOMER' } = input;
    if (sub.plan_id === toPlan.id)
        return { ok: false, error: 'Already on that plan' };
    if (fromPlan.term !== toPlan.term) {
        return { ok: false, error: 'Plan term cannot be changed mid-term — let the current term end and resubscribe.' };
    }
    if (!sub.customer_id)
        return { ok: false, error: 'Subscription is not linked to a customer account' };
    const direction = classifyPlanSwap(fromPlan, toPlan);
    // The current term's end is unchanged; that's the boundary the new plan's perks window starts
    // at, so the customer doesn't get two overlapping grants.
    const termEndsAt = sub.term_ends_at || addMonths(new Date().toISOString(), toPlan.term_months || 1);
    await db.prepare(`
    UPDATE subscriptions
    SET plan_id = ?, plan_term = ?, discount_percent = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(toPlan.id, toPlan.term, toPlan.discount_percent, sub.id).run();
    await recordSubscriptionEvent(db, sub.id, 'PLAN_SWAPPED', actor, {
        from: fromPlan.slug, to: toPlan.slug, direction,
    });
    if (direction === 'UPGRADE') {
        // Issue the new tier's perks for the rest of the current term. Downgrades do NOT issue
        // anything new — the next term boundary is when the new plan's perks arrive, and
        // `grantPlanEntitlements` is idempotent on the (source, starts_at) tuple so a webhook
        // replay can't double up.
        if (sub.term_started_at) {
            await grantPlanEntitlements(db, {
                customerId: sub.customer_id,
                subscriptionId: sub.id,
                plan: toPlan,
                sourceType: 'SUBSCRIPTION',
                startsAt: sub.term_started_at,
                expiresAt: termEndsAt,
            });
        }
    }
    const message = direction === 'UPGRADE'
        ? `Upgraded to ${toPlan.name}. Your new perks are available now; the upgraded rate takes effect on your next renewal.`
        : direction === 'DOWNGRADE'
            ? `Downgraded to ${toPlan.name}. Existing bookings stay as they are; the new (lower) rate takes effect on your next renewal.`
            : `Switched to ${toPlan.name}.`;
    return { ok: true, direction, message, newTermEndsAt: termEndsAt };
}
// ==================== Dunning ====================
/**
 * Re-arms a PAST_DUE subscription once a fresh payment method is on file.
 *
 * The cron sets PAST_DUE and never looks at those rows again (`WHERE status = 'ACTIVE'`), so
 * without this the state is a dead end and the subscription is silently dead. Putting the row
 * back to ACTIVE with a renewal date of now is what makes the next cron run retry the charge.
 */
export async function restorePaymentMethod(db, sub, billing) {
    if (!billing.customerId || !billing.paymentMethodId) {
        return { ok: false, error: 'Stripe did not return a reusable payment method for that session' };
    }
    const restoredStatus = sub.status === 'PAST_DUE'
        ? (sub.plan_term === 'ANNUAL' ? 'PREPAID' : 'ACTIVE')
        : sub.status;
    // A full cycle out, not "now": the session that captured this card also paid for the delivery
    // the failed charge was for, so billing again immediately would charge the same cycle twice.
    const nextRenewal = sub.status === 'PAST_DUE'
        ? addDays(new Date(), FREQUENCY_DAYS[sub.frequency] ?? 14)
        : sub.next_renewal_date;
    await db
        .prepare(`
      UPDATE subscriptions
      SET stripe_customer_id = ?, stripe_payment_method_id = ?, status = ?, next_renewal_date = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
        .bind(billing.customerId, billing.paymentMethodId, restoredStatus, nextRenewal, sub.id)
        .run();
    await recordSubscriptionEvent(db, sub.id, 'PAYMENT_METHOD_UPDATED', 'CUSTOMER', {
        restored_status: restoredStatus,
    });
    return { ok: true };
}
// ==================== Cron-facing jobs (not yet wired — see report) ====================
/**
 * Emails everyone whose next delivery bills within `daysAhead` days.
 *
 * `renewal_notice_sent_for` is stamped with the cycle the notice covered, so re-running the job
 * (or running it hourly) can never mail the same renewal twice; changing the date clears the
 * stamp, which correctly re-arms the notice for the new date.
 *
 * NOT CALLED YET — `apps/api/src/index.ts` owns the cron and is outside this feature's files.
 */
export async function sendUpcomingRenewalNotices(env, daysAhead = 3) {
    const cutoff = addDays(new Date(), daysAhead);
    const { results } = await env.DB.prepare(`
    SELECT * FROM subscriptions
    WHERE status IN ('ACTIVE', 'PREPAID')
      AND next_renewal_date <= ?
      AND next_renewal_date > CURRENT_TIMESTAMP
      AND (renewal_notice_sent_for IS NULL OR renewal_notice_sent_for != next_renewal_date)
  `).bind(cutoff).all();
    const due = (results || []);
    if (!due.length)
        return 0;
    const email = new ResendEmailService(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
    let sent = 0;
    for (const sub of due) {
        const [next] = projectUpcomingShipments(sub, 1);
        if (!next)
            continue;
        const res = await email.send(sub.customer_email, `Your next Daily Roast delivery ships ${new Date(next.scheduled_for).toDateString()}`, renderRenewalNoticeHtml(sub, next, env.STOREFRONT_URL || 'https://dailyroast.in'));
        if (!res.success) {
            console.error(`[PLANS] renewal notice failed for ${sub.id}:`, res.error);
            continue;
        }
        await env.DB.prepare('UPDATE subscriptions SET renewal_notice_sent_for = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sub.next_renewal_date, sub.id).run();
        await recordSubscriptionEvent(env.DB, sub.id, 'RENEWAL_NOTICE_SENT', 'SYSTEM', {
            for_date: sub.next_renewal_date,
        });
        sent++;
    }
    return sent;
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function renderRenewalNoticeHtml(sub, shipment, storefrontUrl) {
    const when = new Date(shipment.scheduled_for).toDateString();
    const chargeLine = shipment.will_charge
        ? `We'll charge <strong>${formatInr(shipment.estimated_total_cents)}</strong> to your saved card on that date.`
        : 'Nothing will be charged — this delivery is already covered by your prepaid term.';
    return `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2b2118;">
      <h1 style="font-size:22px;margin:0 0 6px;">Your next delivery is on its way soon</h1>
      <p style="color:#6b5a4a;margin:0 0 20px;">A heads-up before we roast, so there are no surprises.</p>
      <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b5a4a;">Coffee</td><td style="text-align:right;">${escapeHtml(sub.product_name)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b5a4a;">Grind</td><td style="text-align:right;">${escapeHtml(String(sub.grind_type).replace(/_/g, ' '))}</td></tr>
        <tr><td style="padding:8px 0;color:#6b5a4a;">Quantity</td><td style="text-align:right;">${escapeHtml(sub.quantity)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b5a4a;">Ships</td><td style="text-align:right;"><strong>${escapeHtml(when)}</strong></td></tr>
      </table>
      <p style="font-family:system-ui,sans-serif;font-size:14px;margin:18px 0;">${chargeLine}</p>
      <p style="font-family:system-ui,sans-serif;font-size:14px;">
        Want to skip this one, change the grind, or swap the coffee?
        <a href="${escapeHtml(storefrontUrl)}/#subscription-manager" style="color:#8b5e34;">Manage your subscription</a> —
        changes made before the ship date apply to this delivery.
      </p>
    </div>
  `;
}
/**
 * Creates the orders owed to prepaid (ANNUAL) subscribers without charging them again.
 *
 * The renewal cron only picks up `status = 'ACTIVE'`, and prepaid rows sit in `PREPAID`
 * precisely so that shipping them can never be confused with billing them. That makes this the
 * one piece of Phase 4 that is inert until the cron calls it — chosen deliberately over the
 * alternative failure mode, which was double-charging an annual member on every cycle.
 *
 * NOT CALLED YET — `apps/api/src/index.ts` owns the cron.
 */
export async function processPrepaidShipments(env) {
    const { results } = await env.DB.prepare(`
    SELECT * FROM subscriptions
    WHERE status = 'PREPAID' AND next_renewal_date <= CURRENT_TIMESTAMP
  `).all();
    const due = (results || []);
    let shipped = 0;
    let exhausted = 0;
    for (const sub of due) {
        if ((sub.shipments_remaining ?? 0) <= 0) {
            // The prepaid term is used up. Left PREPAID with nothing remaining rather than silently
            // rolled into a paid ACTIVE subscription — renewing a year is a decision the customer
            // makes, not one a cron makes for them.
            exhausted++;
            continue;
        }
        const orderId = newId('ord');
        const orderNumber = 'TDR-' + Math.floor(100000 + Math.random() * 900000);
        const lineTotal = Math.round(sub.unit_price_cents * (1 - sub.discount_percent / 100)) * sub.quantity;
        await env.DB.batch([
            env.DB.prepare(`
        INSERT INTO orders (
          id, order_number, customer_email, status, subtotal_cents, shipping_cents, tax_cents,
          discount_cents, total_cents, currency, shipping_address_json, notes, created_at, updated_at
        ) VALUES (?, ?, ?, 'PAID', ?, 0, 0, 0, ?, 'inr', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(orderId, orderNumber, sub.customer_email, lineTotal, lineTotal, sub.shipping_address_json || '{}', `Prepaid plan shipment for ${sub.id}`),
            env.DB.prepare(`
        INSERT INTO order_items (
          id, order_id, variant_id, product_name, weight_grams, grind_type,
          unit_price_cents, quantity, total_price_cents, subscription_frequency
        ) VALUES (?, ?, ?, ?, (SELECT weight_grams FROM product_variants WHERE id = ?), ?, ?, ?, ?, ?)
      `).bind(newId('oi'), orderId, sub.variant_id, sub.product_name, sub.variant_id, sub.grind_type, Math.round(sub.unit_price_cents * (1 - sub.discount_percent / 100)), sub.quantity, lineTotal, sub.frequency),
            env.DB.prepare(`
        UPDATE subscriptions
        SET next_renewal_date = ?, shipments_remaining = shipments_remaining - 1, order_id = ?,
            renewal_notice_sent_for = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(addDays(sub.next_renewal_date, FREQUENCY_DAYS[sub.frequency] ?? 14), orderId, sub.id),
        ]);
        shipped++;
    }
    return { shipped, exhausted };
}
