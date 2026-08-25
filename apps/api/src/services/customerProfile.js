/**
 * The taste graph: everything we can infer about a customer from what they actually bought and
 * rated, materialised into `customer_profiles` (migration 0012).
 *
 * Why a snapshot rather than a view: the computation is a five-table aggregate, and the barista
 * chat, the recommendations endpoint and (later) replenishment automation all want it on the hot
 * path. The snapshot is a pure cache — `computeTasteProfile` is the truth and can rebuild it at
 * any time, which is why nothing else is ever allowed to write to these columns.
 */
/**
 * Orders that count toward money and cadence. PENDING_PAYMENT never became revenue; CANCELLED
 * and REFUNDED were unwound. Including any of them would inflate LTV and, worse, poison the
 * reorder cadence with orders that were never delivered.
 */
const COUNTED_STATUSES = ['PAID', 'ROASTING', 'PACKED', 'SHIPPED', 'DELIVERED'];
const COUNTED_STATUS_SQL = COUNTED_STATUSES.map(() => '?').join(', ');
/** A snapshot older than this is refreshed on the next read (see `getTasteProfile`). */
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Segment thresholds. Named constants rather than inline numbers because the loyalty phase
 * (2.4) will want to reuse exactly these boundaries for its tiers.
 */
const VIP_MIN_ORDERS = 5;
const VIP_MIN_LTV_CENTS = 25_000;
const LOYAL_MIN_ORDERS = 3;
const ACTIVE_MAX_DAYS = 60;
const AT_RISK_MAX_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Order ownership predicate. `orders.customer_id` is nullable and checkout.ts does not populate
 * it (it only ever writes `customer_email`), so matching on the id alone would return nothing
 * for real customers. Email is compared case-insensitively because checkout takes it from a
 * free-text field while sessions store it lowercased.
 */
const ORDER_OWNER_SQL = '(o.customer_id = ? OR LOWER(o.customer_email) = ?)';
export function orderOwnerBindings(customerId, email) {
    return [customerId, email.trim().toLowerCase()];
}
/** Ranks a tally into a share-normalised distribution, biggest first. */
function toDistribution(tally, limit = 8) {
    let total = 0;
    for (const units of tally.values())
        total += units;
    if (total <= 0)
        return [];
    return Array.from(tally.entries())
        .map(([key, units]) => ({ key, units, share: Math.round((units / total) * 1000) / 1000 }))
        .sort((a, b) => b.units - a.units || a.key.localeCompare(b.key))
        .slice(0, limit);
}
/**
 * RFM bucket. Precedence is fixed and total — a customer matches exactly one label — so the
 * same inputs always produce the same segment no matter when it is recomputed.
 */
export function classifySegment(input) {
    const { totalOrders, lifetimeValueCents, daysSinceLastOrder } = input;
    if (totalOrders === 0 || daysSinceLastOrder === null)
        return 'NEW';
    // Dormancy dominates: a former VIP who has not ordered in six months is a win-back target,
    // not a VIP, and marketing needs to see them that way.
    if (daysSinceLastOrder > AT_RISK_MAX_DAYS)
        return 'LAPSED';
    if (daysSinceLastOrder > ACTIVE_MAX_DAYS)
        return 'AT_RISK';
    if (totalOrders >= VIP_MIN_ORDERS && lifetimeValueCents >= VIP_MIN_LTV_CENTS)
        return 'VIP';
    if (totalOrders >= LOYAL_MIN_ORDERS)
        return 'LOYAL';
    if (totalOrders > 1)
        return 'ACTIVE';
    return 'NEW';
}
/** Mean gap in days between consecutive orders. NULL below two orders — one order has no cadence. */
export function meanReorderCadenceDays(orderedAscIso) {
    if (orderedAscIso.length < 2)
        return null;
    const first = Date.parse(orderedAscIso[0]);
    const last = Date.parse(orderedAscIso[orderedAscIso.length - 1]);
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first)
        return null;
    // (last - first) / gaps rather than averaging each gap: identical result, and immune to a
    // single malformed timestamp in the middle of the series.
    const days = (last - first) / DAY_MS / (orderedAscIso.length - 1);
    return Math.round(days * 10) / 10;
}
/**
 * Recomputes the whole profile from source tables. Pure read — persistence is `saveTasteProfile`.
 */
export async function computeTasteProfile(db, customerId, email) {
    const [ownerId, ownerEmail] = orderOwnerBindings(customerId, email);
    const { results: orderRows } = await db
        .prepare(`SELECT o.id, o.status, o.total_cents, o.created_at
         FROM orders o
        WHERE ${ORDER_OWNER_SQL}
          AND o.status IN (${COUNTED_STATUS_SQL})
        ORDER BY o.created_at ASC`)
        .bind(ownerId, ownerEmail, ...COUNTED_STATUSES)
        .all();
    const orders = orderRows || [];
    // order_items carries no product_id, roast level or origin — the taste graph only exists via
    // variant -> product_variants -> products. LEFT JOIN so a delisted product still contributes
    // its grind and bag weight instead of dropping the whole line.
    const { results: itemRows } = await db
        .prepare(`SELECT oi.variant_id,
              pv.product_id AS product_id,
              oi.product_name,
              oi.weight_grams,
              oi.grind_type,
              oi.quantity,
              p.roast_level,
              p.origin_country,
              p.process_method
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = pv.product_id
        WHERE ${ORDER_OWNER_SQL}
          AND o.status IN (${COUNTED_STATUS_SQL})`)
        .bind(ownerId, ownerEmail, ...COUNTED_STATUSES)
        .all();
    const items = itemRows || [];
    // reviews (0005) has no customer_id — only a self-reported order_number — so the customer's
    // own ratings are reachable only by joining back through orders. Sparse by construction.
    const { results: reviewRows } = await db
        .prepare(`SELECT r.product_id, r.rating
         FROM reviews r
         JOIN orders o ON o.order_number = r.order_number
        WHERE ${ORDER_OWNER_SQL}`)
        .bind(ownerId, ownerEmail)
        .all();
    const reviews = reviewRows || [];
    const totalOrders = orders.length;
    const lifetimeValueCents = orders.reduce((acc, o) => acc + Number(o.total_cents || 0), 0);
    const aovCents = totalOrders > 0 ? Math.round(lifetimeValueCents / totalOrders) : 0;
    const firstOrderAt = totalOrders > 0 ? orders[0].created_at : null;
    const lastOrderAt = totalOrders > 0 ? orders[totalOrders - 1].created_at : null;
    let daysSinceLastOrder = null;
    if (lastOrderAt) {
        const parsed = Date.parse(lastOrderAt);
        if (Number.isFinite(parsed)) {
            daysSinceLastOrder = Math.max(0, Math.floor((Date.now() - parsed) / DAY_MS));
        }
    }
    const roastTally = new Map();
    const originTally = new Map();
    const processTally = new Map();
    const productTally = new Map();
    const grindTally = new Map();
    const weightTally = new Map();
    for (const it of items) {
        // Weighted by bags, not by line: two bags of Yirgacheffe is twice the signal of one.
        const units = Math.max(1, Number(it.quantity || 1));
        if (it.roast_level)
            roastTally.set(it.roast_level, (roastTally.get(it.roast_level) || 0) + units);
        if (it.origin_country)
            originTally.set(it.origin_country, (originTally.get(it.origin_country) || 0) + units);
        if (it.process_method)
            processTally.set(it.process_method, (processTally.get(it.process_method) || 0) + units);
        if (it.product_id)
            productTally.set(it.product_id, (productTally.get(it.product_id) || 0) + units);
        if (it.grind_type)
            grindTally.set(it.grind_type, (grindTally.get(it.grind_type) || 0) + units);
        if (it.weight_grams)
            weightTally.set(String(it.weight_grams), (weightTally.get(String(it.weight_grams)) || 0) + units);
    }
    const roastDistribution = toDistribution(roastTally);
    const originDistribution = toDistribution(originTally);
    const processDistribution = toDistribution(processTally);
    const productAffinity = toDistribution(productTally);
    const grindDistribution = toDistribution(grindTally, 1);
    const weightDistribution = toDistribution(weightTally, 1);
    const reviewCount = reviews.length;
    const avgReviewRating = reviewCount > 0
        ? Math.round((reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) / reviewCount) * 100) / 100
        : null;
    // "The Yirgacheffe you rated 5 stars" — the highest-rated product they reviewed, ties broken
    // toward whichever they bought more of.
    let topRatedProductId = null;
    let bestRating = -1;
    for (const r of reviews) {
        const rating = Number(r.rating || 0);
        if (rating > bestRating || (rating === bestRating && (productTally.get(r.product_id) || 0) > (productTally.get(topRatedProductId || '') || 0))) {
            bestRating = rating;
            topRatedProductId = r.product_id;
        }
    }
    return {
        customer_id: customerId,
        total_orders: totalOrders,
        lifetime_value_cents: lifetimeValueCents,
        aov_cents: aovCents,
        first_order_at: firstOrderAt,
        last_order_at: lastOrderAt,
        days_since_last_order: daysSinceLastOrder,
        reorder_cadence_days: meanReorderCadenceDays(orders.map((o) => o.created_at)),
        favourite_grind: grindDistribution[0]?.key ?? null,
        typical_weight_grams: weightDistribution[0] ? Number(weightDistribution[0].key) : null,
        top_roast_level: roastDistribution[0]?.key ?? null,
        top_origin_country: originDistribution[0]?.key ?? null,
        top_product_id: productAffinity[0]?.key ?? null,
        roast_distribution: roastDistribution,
        origin_distribution: originDistribution,
        process_distribution: processDistribution,
        product_affinity: productAffinity,
        review_count: reviewCount,
        avg_review_rating: avgReviewRating,
        top_rated_product_id: topRatedProductId,
        segment: classifySegment({ totalOrders, lifetimeValueCents, daysSinceLastOrder }),
        computed_at: new Date().toISOString(),
    };
}
/** Upserts the snapshot. The only writer of `customer_profiles`. */
export async function saveTasteProfile(db, profile) {
    await db
        .prepare(`INSERT INTO customer_profiles (
         customer_id, total_orders, lifetime_value_cents, aov_cents, first_order_at, last_order_at,
         days_since_last_order, reorder_cadence_days, favourite_grind, typical_weight_grams,
         top_roast_level, top_origin_country, top_product_id, roast_distribution_json,
         origin_distribution_json, process_distribution_json, product_affinity_json,
         review_count, avg_review_rating, top_rated_product_id, segment, computed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         total_orders = excluded.total_orders,
         lifetime_value_cents = excluded.lifetime_value_cents,
         aov_cents = excluded.aov_cents,
         first_order_at = excluded.first_order_at,
         last_order_at = excluded.last_order_at,
         days_since_last_order = excluded.days_since_last_order,
         reorder_cadence_days = excluded.reorder_cadence_days,
         favourite_grind = excluded.favourite_grind,
         typical_weight_grams = excluded.typical_weight_grams,
         top_roast_level = excluded.top_roast_level,
         top_origin_country = excluded.top_origin_country,
         top_product_id = excluded.top_product_id,
         roast_distribution_json = excluded.roast_distribution_json,
         origin_distribution_json = excluded.origin_distribution_json,
         process_distribution_json = excluded.process_distribution_json,
         product_affinity_json = excluded.product_affinity_json,
         review_count = excluded.review_count,
         avg_review_rating = excluded.avg_review_rating,
         top_rated_product_id = excluded.top_rated_product_id,
         segment = excluded.segment,
         computed_at = excluded.computed_at`)
        .bind(profile.customer_id, profile.total_orders, profile.lifetime_value_cents, profile.aov_cents, profile.first_order_at, profile.last_order_at, profile.days_since_last_order, profile.reorder_cadence_days, profile.favourite_grind, profile.typical_weight_grams, profile.top_roast_level, profile.top_origin_country, profile.top_product_id, JSON.stringify(profile.roast_distribution), JSON.stringify(profile.origin_distribution), JSON.stringify(profile.process_distribution), JSON.stringify(profile.product_affinity), profile.review_count, profile.avg_review_rating, profile.top_rated_product_id, profile.segment, profile.computed_at)
        .run();
}
function parseAffinities(raw) {
    if (typeof raw !== 'string' || raw.trim() === '')
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function rowToProfile(row) {
    return {
        customer_id: row.customer_id,
        total_orders: Number(row.total_orders || 0),
        lifetime_value_cents: Number(row.lifetime_value_cents || 0),
        aov_cents: Number(row.aov_cents || 0),
        first_order_at: row.first_order_at || null,
        last_order_at: row.last_order_at || null,
        days_since_last_order: row.days_since_last_order === null || row.days_since_last_order === undefined
            ? null
            : Number(row.days_since_last_order),
        reorder_cadence_days: row.reorder_cadence_days === null || row.reorder_cadence_days === undefined
            ? null
            : Number(row.reorder_cadence_days),
        favourite_grind: row.favourite_grind || null,
        typical_weight_grams: row.typical_weight_grams ? Number(row.typical_weight_grams) : null,
        top_roast_level: row.top_roast_level || null,
        top_origin_country: row.top_origin_country || null,
        top_product_id: row.top_product_id || null,
        roast_distribution: parseAffinities(row.roast_distribution_json),
        origin_distribution: parseAffinities(row.origin_distribution_json),
        process_distribution: parseAffinities(row.process_distribution_json),
        product_affinity: parseAffinities(row.product_affinity_json),
        review_count: Number(row.review_count || 0),
        avg_review_rating: row.avg_review_rating === null || row.avg_review_rating === undefined
            ? null
            : Number(row.avg_review_rating),
        top_rated_product_id: row.top_rated_product_id || null,
        segment: (row.segment || 'NEW'),
        computed_at: row.computed_at,
    };
}
/** Recompute + persist in one call. Used by the lifecycle hooks and the explicit recompute route. */
export async function refreshTasteProfile(db, customerId, email) {
    const profile = await computeTasteProfile(db, customerId, email);
    await saveTasteProfile(db, profile);
    return profile;
}
/**
 * Reads the snapshot, filling it in on the fly when it is missing or stale.
 *
 * The lazy fill matters: hooks only fire on *new* orders, so without it every customer who
 * already had orders when 0012 shipped would see an empty profile forever. `days_since_last_order`
 * also drifts on its own with the calendar, which is the other half of why staleness is a TTL and
 * not just an event.
 */
export async function getTasteProfile(db, customerId, email, opts = {}) {
    if (!opts.force) {
        const row = await db
            .prepare('SELECT * FROM customer_profiles WHERE customer_id = ?')
            .bind(customerId)
            .first();
        if (row) {
            const computedAt = Date.parse(row.computed_at);
            if (Number.isFinite(computedAt) && Date.now() - computedAt < SNAPSHOT_TTL_MS) {
                return rowToProfile(row);
            }
        }
    }
    return refreshTasteProfile(db, customerId, email);
}
function humanGrind(value) {
    return value ? value.replace(/_/g, ' ').toLowerCase() : null;
}
/**
 * A compact, token-cheap rendering of the profile for the AI barista's system context.
 * Returns null when there is nothing worth saying, so anonymous and brand-new visitors cost
 * the prompt nothing.
 */
export function summariseProfileForAgent(profile, prefs) {
    const facts = [];
    if (profile.total_orders > 0) {
        facts.push(`${profile.total_orders} past order${profile.total_orders === 1 ? '' : 's'} (segment ${profile.segment})`);
    }
    if (profile.top_roast_level)
        facts.push(`prefers ${profile.top_roast_level.replace(/_/g, ' ').toLowerCase()} roasts`);
    if (profile.top_origin_country)
        facts.push(`buys most often from ${profile.top_origin_country}`);
    const grind = prefs?.default_grind || profile.favourite_grind;
    if (grind)
        facts.push(`usual grind ${humanGrind(grind)}`);
    const weight = prefs?.default_weight_grams || profile.typical_weight_grams;
    if (weight)
        facts.push(`usual bag ${weight}g`);
    if (prefs?.brew_method)
        facts.push(`brews with ${prefs.brew_method}`);
    if (profile.reorder_cadence_days)
        facts.push(`reorders roughly every ${Math.round(profile.reorder_cadence_days)} days`);
    if (profile.days_since_last_order !== null)
        facts.push(`last ordered ${profile.days_since_last_order} days ago`);
    if (profile.avg_review_rating !== null)
        facts.push(`rates our coffees ${profile.avg_review_rating}/5 on average`);
    if (facts.length === 0)
        return null;
    return [
        'KNOWN CUSTOMER CONTEXT (from their own purchase history — use it to personalise, never recite it back as a list, and never claim to know anything beyond it):',
        `- ${facts.join('; ')}.`,
    ].join('\n');
}
