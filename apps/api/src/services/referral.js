import { creditPoints, debitPoints, resolveOrderCustomer } from './loyalty';
/**
 * Referral programme.
 *
 * Dual-sided and deliberately asymmetric in timing: the referee's discount lands immediately at
 * checkout (it has to, or there is no reason to use the code), while the referrer is only paid
 * once the referred order is *delivered*. Delivery — not payment — is the point at which the
 * reward stops being reversible, which is what makes the cheapest referral fraud (order, get
 * paid, refund) unprofitable.
 */
export const REFERRAL_RATES = {
    /** Off the referee's first order, in minor units. 15000 = ₹150. */
    REFEREE_DISCOUNT_CENTS: 15_000,
    /** Referee's basket must clear this before the code applies. 50000 = ₹500. */
    REFEREE_MIN_ORDER_CENTS: 50_000,
    /** Paid to the referrer on delivery. At 50 paise a point this is ₹150 — a matched reward. */
    REFERRER_POINTS: 300,
    /** Velocity cap: rewarded referrals one account can accrue in a rolling 30 days. */
    MAX_REFERRALS_PER_30_DAYS: 10,
};
const CODE_LENGTH = 8;
// No I/O/0/1 — these codes get read off a phone screen and typed back in.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newId(prefix) {
    return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
function generateCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}
function normalizePhone(phone) {
    // India-facing: +91 98765 43210, 09876543210 and 9876543210 are all the same subscriber.
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}
function normalizeAddress(line1, postal) {
    return `${String(line1 || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${String(postal || '').replace(/\D/g, '')}`;
}
// ---------------------------------------------------------------------------------------------
// Codes & sharing
// ---------------------------------------------------------------------------------------------
/**
 * The customer's one durable code, minted on first request. Durable by design: an old WhatsApp
 * forward has to keep working, so the code is never rotated.
 */
export async function getOrCreateCode(db, customerId) {
    const existing = await db
        .prepare('SELECT code FROM referral_codes WHERE customer_id = ?')
        .bind(customerId)
        .first();
    if (existing)
        return existing.code;
    // Retry on the UNIQUE collision rather than pre-checking; at 32^8 the loop effectively never
    // runs twice, and the index is the only guard that is safe under concurrency.
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        const res = await db
            .prepare('INSERT INTO referral_codes (id, customer_id, code) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
            .bind(newId('ref'), customerId, code)
            .run();
        if (res?.meta?.changes)
            return code;
        const row = await db
            .prepare('SELECT code FROM referral_codes WHERE customer_id = ?')
            .bind(customerId)
            .first();
        if (row)
            return row.code; // lost the race to our own concurrent request
    }
    throw new Error('Could not allocate a referral code');
}
export function buildShareTargets(code, storefrontUrl) {
    const url = `${storefrontUrl.replace(/\/$/, '')}/?ref=${encodeURIComponent(code)}`;
    const message = `I'm drinking small-batch coffee roasted in Bangalore by The Daily Roast. ` +
        `Use my code ${code} for ₹${REFERRAL_RATES.REFEREE_DISCOUNT_CENTS / 100} off your first bag: ${url}`;
    return {
        url,
        whatsapp_url: `https://wa.me/?text=${encodeURIComponent(message)}`,
        message,
    };
}
/** Records a share-link landing. The UNIQUE index makes a refresh a no-op, not a new invite. */
export async function recordVisit(db, code, visitorHash) {
    const owner = await db
        .prepare('SELECT customer_id FROM referral_codes WHERE code = ? AND is_active = 1')
        .bind(code)
        .first();
    if (!owner)
        return false;
    await db
        .prepare(`
      INSERT INTO referral_visits (id, code, referrer_customer_id, visitor_hash)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code, visitor_hash) DO NOTHING
    `)
        .bind(newId('rvis'), code, owner.customer_id, visitorHash)
        .run();
    return true;
}
/** Coarse, non-reversible visitor fingerprint for de-duplicating invite counts. */
export async function hashVisitor(ip, userAgent) {
    const data = new TextEncoder().encode(`${ip}|${userAgent}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Everything that has to be true before a code is worth anything. Called from the storefront's
 * preview endpoint and again — authoritatively — from checkout, exactly like `validateCoupon`:
 * a client-sent discount amount is never trusted.
 */
export async function checkReferral(db, input) {
    const code = String(input.code || '').trim().toUpperCase();
    const refereeEmail = normalizeEmail(input.refereeEmail);
    const fail = (error, blockedReason) => ({
        valid: false,
        error,
        discount_cents: 0,
        blockedReason,
    });
    if (!code)
        return fail('Referral code required');
    if (!refereeEmail)
        return fail('Email required to apply a referral code');
    const owner = await db
        .prepare(`
      SELECT rc.customer_id, c.email, c.phone, c.full_name
      FROM referral_codes rc JOIN customers c ON c.id = rc.customer_id
      WHERE rc.code = ? AND rc.is_active = 1
    `)
        .bind(code)
        .first();
    if (!owner)
        return fail('That referral code is not valid');
    // --- Guard 1: self-referral by email.
    if (normalizeEmail(owner.email) === refereeEmail) {
        return fail('You cannot use your own referral code', 'SELF_EMAIL');
    }
    // --- Guard 2: self-referral by phone. Same handset, second email address.
    const refereePhone = normalizePhone(input.refereePhone);
    if (refereePhone && refereePhone.length >= 10 && normalizePhone(owner.phone) === refereePhone) {
        return fail('That referral code cannot be used on this account', 'SELF_PHONE');
    }
    // --- Guard 3: one reward per referee, ever. The partial UNIQUE index enforces this at write
    // time; this check exists only so the shopper gets a sentence instead of a constraint error.
    const priorReferral = await db
        .prepare(`SELECT id FROM referrals WHERE referee_email_norm = ? AND status <> 'BLOCKED' LIMIT 1`)
        .bind(refereeEmail)
        .first();
    if (priorReferral)
        return fail('This email has already used a referral code', 'ALREADY_REFERRED');
    // --- Guard 4: referrals are for new customers. An existing shopper cannot be "referred".
    const priorOrder = await db
        .prepare(`
      SELECT id FROM orders
      WHERE customer_email = ? AND status NOT IN ('PENDING_PAYMENT', 'CANCELLED')
      LIMIT 1
    `)
        .bind(refereeEmail)
        .first();
    if (priorOrder)
        return fail('Referral codes are for first orders only', 'EXISTING_CUSTOMER');
    // --- Guard 5: self-referral by delivery address. The most common dodge is a second email
    // shipping to the same flat, so compare against where the referrer has actually had coffee
    // delivered rather than against `customer_addresses` (which checkout never writes).
    const refereeAddress = normalizeAddress(input.shippingLine1, input.shippingPostal);
    if (refereeAddress !== '|' && refereeAddress.length > 4) {
        const { results: referrerOrders } = await db
            .prepare(`
        SELECT shipping_address_json FROM orders
        WHERE (customer_id = ? OR customer_email = ?) AND status <> 'CANCELLED'
        ORDER BY created_at DESC LIMIT 20
      `)
            .bind(owner.customer_id, owner.email)
            .all();
        for (const row of referrerOrders || []) {
            try {
                const addr = JSON.parse(row.shipping_address_json || '{}');
                if (normalizeAddress(addr.line1, addr.postal_code) === refereeAddress) {
                    return fail('That referral code cannot be used for this delivery address', 'SELF_ADDRESS');
                }
            }
            catch {
                // A malformed legacy address blob is not a reason to block a genuine referral.
            }
        }
    }
    // --- Guard 6: velocity. A single account farming codes is throttled rather than banned.
    const recent = await db
        .prepare(`
      SELECT COUNT(*) AS n FROM referrals
      WHERE referrer_customer_id = ? AND status <> 'BLOCKED' AND created_at >= datetime('now', '-30 days')
    `)
        .bind(owner.customer_id)
        .first();
    if (Number(recent?.n || 0) >= REFERRAL_RATES.MAX_REFERRALS_PER_30_DAYS) {
        return fail('This referral code has reached its limit for now');
    }
    if (input.subtotalCents < REFERRAL_RATES.REFEREE_MIN_ORDER_CENTS) {
        return fail(`Referral codes apply to orders over ₹${REFERRAL_RATES.REFEREE_MIN_ORDER_CENTS / 100}`);
    }
    return {
        valid: true,
        code,
        // Never discount more than the basket is worth.
        discount_cents: Math.min(REFERRAL_RATES.REFEREE_DISCOUNT_CENTS, input.subtotalCents),
        referrer_name: (owner.full_name || owner.email.split('@')[0]) ?? undefined,
        referrerCustomerId: owner.customer_id,
    };
}
/**
 * The statement that binds a validated referral to the order that earned it.
 *
 * Returned rather than executed so checkout can put it in the *same* `db.batch` as the order
 * insert: the referee's discount and the referral row have to land together or not at all.
 * Deliberately no `ON CONFLICT DO NOTHING` — if a concurrent checkout already claimed this
 * referee, the partial UNIQUE index must fail the batch rather than let a second discounted
 * order through with no referral behind it.
 */
export function referralAttachStatement(db, input) {
    return db
        .prepare(`
      INSERT INTO referrals (
        id, referrer_customer_id, code, referee_customer_id, referee_email_norm,
        referee_phone, order_id, status, referee_discount_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ATTRIBUTED', ?)
    `)
        .bind(newId('rfl'), input.referrerCustomerId, input.code, input.refereeCustomerId ?? null, normalizeEmail(input.refereeEmail), normalizePhone(input.refereePhone) || null, input.orderId, input.discountCents);
}
// ---------------------------------------------------------------------------------------------
// Payout & reversal
// ---------------------------------------------------------------------------------------------
/**
 * Pays the referrer once the referred order is delivered. Idempotent through the loyalty
 * ledger's key, so a replayed courier webhook cannot pay twice.
 */
export async function qualifyReferral(db, orderId) {
    const referral = await db
        .prepare(`SELECT * FROM referrals WHERE order_id = ? AND status = 'ATTRIBUTED'`)
        .bind(orderId)
        .first();
    if (!referral)
        return 0;
    // Bind the referee to their account now if they created one after ordering — the dashboard's
    // "signed up" count depends on it.
    const refereeCustomer = await db
        .prepare('SELECT id FROM customers WHERE email = ?')
        .bind(referral.referee_email_norm)
        .first();
    const credited = await creditPoints(db, {
        customerId: referral.referrer_customer_id,
        points: REFERRAL_RATES.REFERRER_POINTS,
        entryType: 'EARN',
        reason: 'REFERRAL_REWARD',
        refType: 'REFERRAL',
        refId: referral.id,
        note: 'Referral reward — your friend’s order was delivered',
        idempotencyKey: `referral:reward:${referral.id}`,
    });
    await db
        .prepare(`
      UPDATE referrals
      SET status = 'QUALIFIED',
          referrer_points_awarded = ?,
          referee_customer_id = COALESCE(referee_customer_id, ?),
          qualified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'ATTRIBUTED'
    `)
        .bind(REFERRAL_RATES.REFERRER_POINTS, refereeCustomer?.id ?? null, referral.id)
        .run();
    return credited.applied ? credited.points : 0;
}
/** Unwinds a referral whose order was refunded, taking back any points already paid out. */
export async function reverseReferral(db, orderId) {
    const referral = await db
        .prepare(`SELECT * FROM referrals WHERE order_id = ? AND status IN ('ATTRIBUTED', 'QUALIFIED')`)
        .bind(orderId)
        .first();
    if (!referral)
        return 0;
    let reclaimed = 0;
    if (Number(referral.referrer_points_awarded) > 0) {
        const res = await debitPoints(db, {
            customerId: referral.referrer_customer_id,
            points: Number(referral.referrer_points_awarded),
            entryType: 'ADJUST',
            reason: 'REFUND_CLAWBACK',
            refType: 'REFERRAL',
            refId: referral.id,
            note: 'Referral reward reversed — the referred order was refunded',
            idempotencyKey: `referral:reverse:${referral.id}`,
            allowNegative: true,
        });
        reclaimed = res.applied ? res.points : 0;
    }
    await db
        .prepare(`UPDATE referrals SET status = 'REVERSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(referral.id)
        .run();
    return reclaimed;
}
/** True when this order was attributed to someone's code. Used by the delivery hook. */
export async function orderHasReferral(db, orderId) {
    const row = await db.prepare('SELECT id FROM referrals WHERE order_id = ?').bind(orderId).first();
    return Boolean(row);
}
// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------
function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    if (!domain)
        return '•••';
    const head = local.slice(0, 2);
    return `${head}${'•'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}
export async function getDashboard(db, customerId, storefrontUrl) {
    const code = await getOrCreateCode(db, customerId);
    const invited = await db
        .prepare('SELECT COUNT(*) AS n FROM referral_visits WHERE referrer_customer_id = ?')
        .bind(customerId)
        .first();
    const funnel = await db
        .prepare(`
      SELECT
        COUNT(*) AS purchased,
        SUM(CASE WHEN referee_customer_id IS NOT NULL THEN 1 ELSE 0 END) AS signed_up,
        SUM(CASE WHEN status = 'QUALIFIED' THEN referrer_points_awarded ELSE 0 END) AS earned,
        SUM(CASE WHEN status = 'ATTRIBUTED' THEN ? ELSE 0 END) AS pending
      FROM referrals
      WHERE referrer_customer_id = ? AND status <> 'BLOCKED'
    `)
        .bind(REFERRAL_RATES.REFERRER_POINTS, customerId)
        .first();
    const { results: recent } = await db
        .prepare(`
      SELECT referee_email_norm, status, referrer_points_awarded, created_at
      FROM referrals
      WHERE referrer_customer_id = ? AND status <> 'BLOCKED'
      ORDER BY created_at DESC LIMIT 10
    `)
        .bind(customerId)
        .all();
    const stats = {
        // A landing that converted still counts as an invite even if the visit was never recorded
        // (WhatsApp forwards get opened in in-app browsers that drop the hit).
        invited: Math.max(Number(invited?.n || 0), Number(funnel?.purchased || 0)),
        signed_up: Number(funnel?.signed_up || 0),
        purchased: Number(funnel?.purchased || 0),
        points_earned: Number(funnel?.earned || 0),
        points_pending: Number(funnel?.pending || 0),
    };
    return {
        code,
        share: buildShareTargets(code, storefrontUrl),
        stats,
        referee_discount_cents: REFERRAL_RATES.REFEREE_DISCOUNT_CENTS,
        referrer_points: REFERRAL_RATES.REFERRER_POINTS,
        recent: (recent || []).map((r) => ({
            referee_masked: maskEmail(r.referee_email_norm),
            status: r.status,
            points: Number(r.referrer_points_awarded || 0),
            created_at: r.created_at,
        })),
    };
}
/** Re-exported so the delivery hook can resolve the referrer without importing loyalty directly. */
export { resolveOrderCustomer };
