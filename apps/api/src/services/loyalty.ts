import type { Env } from '../types/env';
import type {
  LoyaltyEntryType,
  LoyaltyLedgerEntry,
  LoyaltyReason,
  LoyaltyRedemptionPreview,
  LoyaltySummary,
  LoyaltyTier,
  LoyaltyTierInfo,
} from '@daily-grind/shared-types';
import { grantEntitlement, listActiveGrants } from './entitlements';

/**
 * Loyalty points engine.
 *
 * Backed by `loyalty_ledger` (immutable) + `customers.loyalty_points` (cached rollup), the same
 * shape as the inventory ledger and the entitlement ledger: the ledger is the truth, the column
 * on `customers` is a cache we recompute from the ledger after every mutation so it cannot drift.
 *
 * BALANCE INVARIANT — the authoritative balance is `SUM(points_delta)`. The `expires_at` /
 * `points_consumed` columns on EARN rows are a FIFO *expiry schedule*, not a second balance: a
 * refund clawback can take the authoritative balance below what the open lots still hold, so
 * expiry clamps to the authoritative balance rather than to the lot remainder.
 *
 * There is no cron slot this feature may wire (the scheduled handler lives in index.ts, which
 * feature work must not edit), so expiry and the reclaim of abandoned checkout holds are both
 * evaluated lazily, on read, in `refreshCustomerLoyalty`.
 */

// ---------------------------------------------------------------------------------------------
// Programme rates. Every tunable number lives here and nowhere else.
//
// Monetary values are minor units ("cents" throughout this codebase, paise in practice — the
// storefront renders `total_cents / 100` as ₹). Earning ₹10 → 1 point and spending 1 point →
// ₹0.50 makes the headline rate 5% back.
// ---------------------------------------------------------------------------------------------
export const LOYALTY_RATES = {
  /** Rupees of net merchandise spend that earn one point on a DELIVERED order. */
  RUPEES_PER_POINT_EARNED: 10,
  /** What one point is worth when redeemed, in minor units. 50 = ₹0.50. */
  POINT_VALUE_CENTS: 50,

  /** Bonus grants. */
  SIGNUP_BONUS_POINTS: 50, // matches the value routes/customer.ts has always written
  REVIEW_BONUS_POINTS: 25,
  SUBSCRIPTION_STREAK_POINTS: 100,
  /** A streak bonus is paid on every Nth delivered order while a subscription is ACTIVE. */
  SUBSCRIPTION_STREAK_EVERY: 3,

  /** Redemption guardrails. */
  MIN_REDEEM_POINTS: 200,          // ₹100 floor — keeps 3-point redemptions out of the ledger
  MAX_REDEEM_PERCENT: 20,          // of the post-coupon merchandise subtotal

  /** Points lapse this many months after they were earned. */
  EXPIRY_MONTHS: 18,
  /** Statement/summary warns about lots lapsing inside this window. */
  EXPIRY_WARNING_DAYS: 60,

  /**
   * An unpaid checkout hold is released after this long, so an abandoned basket does not burn
   * the shopper's points. (Coupons have the same hole today and no release; see the reclaim
   * pass below.)
   */
  REDEMPTION_HOLD_MINUTES: 60,

  /** Trailing-12-month delivered spend, in minor units, required for each tier. */
  TIER_THRESHOLDS_CENTS: { BRONZE: 0, SILVER: 1_000_000, GOLD: 3_000_000 } as Record<LoyaltyTier, number>,
  /** Earn rate multiplier by tier. */
  TIER_MULTIPLIERS: { BRONZE: 1, SILVER: 1.25, GOLD: 1.5 } as Record<LoyaltyTier, number>,
} as const;

const TIER_ORDER: LoyaltyTier[] = ['BRONZE', 'SILVER', 'GOLD'];

/**
 * Consumable tier perks. These are issued through the entitlement engine with
 * `sourceType: 'LOYALTY_TIER'` rather than through a loyalty-specific perk table — plans and
 * bookings already speak that language.
 */
const TIER_ENTITLEMENTS: Record<LoyaltyTier, string[]> = {
  BRONZE: [],
  SILVER: ['FREE_SHIPPING'],
  GOLD: ['FREE_SHIPPING', 'EARLY_ACCESS'],
};

const TIER_PERK_LABELS: Record<LoyaltyTier, string[]> = {
  BRONZE: ['1 point per ₹10 spent', 'Points never touched by shipping or tax'],
  SILVER: ['1.25× points on every delivery', 'Free roastery shipping', 'Priority dispatch'],
  GOLD: ['1.5× points on every delivery', 'Free roastery shipping', 'Early access to limited-edition lots'],
};

function newId(prefix: string): string {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function addMonths(from: Date, months: number): string {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

/** Points earned by a given amount of net merchandise spend at a given tier. */
export function pointsForSpend(netCents: number, tier: LoyaltyTier = 'BRONZE'): number {
  if (netCents <= 0) return 0;
  const base = Math.floor(netCents / (LOYALTY_RATES.RUPEES_PER_POINT_EARNED * 100));
  return Math.round(base * LOYALTY_RATES.TIER_MULTIPLIERS[tier]);
}

export function pointsToCents(points: number): number {
  return Math.max(0, Math.floor(points)) * LOYALTY_RATES.POINT_VALUE_CENTS;
}

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

export interface LoyaltyCustomer {
  id: string;
  email: string;
  loyalty_points: number;
  loyalty_tier: LoyaltyTier;
}

/**
 * Resolves the customer behind an order. Checkout only started stamping `orders.customer_id`
 * with this phase, so every historical order — and every genuine guest order — has to fall back
 * to the email on the order itself.
 */
export async function resolveOrderCustomer(
  db: Env['DB'],
  order: { customer_id?: string | null; customer_email?: string | null }
): Promise<LoyaltyCustomer | null> {
  if (order.customer_id) {
    const byId = await db
      .prepare('SELECT id, email, loyalty_points, loyalty_tier FROM customers WHERE id = ?')
      .bind(order.customer_id)
      .first<LoyaltyCustomer>();
    if (byId) return byId;
  }
  if (!order.customer_email) return null;
  return await db
    .prepare('SELECT id, email, loyalty_points, loyalty_tier FROM customers WHERE email = ?')
    .bind(order.customer_email)
    .first<LoyaltyCustomer>();
}

// ---------------------------------------------------------------------------------------------
// Ledger primitives
// ---------------------------------------------------------------------------------------------

/**
 * Recomputes the cached rollups on `customers` straight from the ledger. Returned as a statement
 * so callers can batch it with the write that made it stale — a rollup that is recomputed rather
 * than incremented is self-healing after a partial failure.
 */
function rollupStatement(db: Env['DB'], customerId: string) {
  return db
    .prepare(`
      UPDATE customers
      SET loyalty_points = (SELECT COALESCE(SUM(points_delta), 0) FROM loyalty_ledger WHERE customer_id = ?),
          loyalty_points_lifetime = (
            SELECT COALESCE(SUM(points_delta), 0) FROM loyalty_ledger WHERE customer_id = ? AND points_delta > 0
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(customerId, customerId, customerId);
}

export interface LedgerWrite {
  customerId: string;
  points: number;               // always positive; `entryType` decides the sign
  entryType: LoyaltyEntryType;
  reason: LoyaltyReason;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  /** Required for anything a client can retry. A repeat call is a no-op, never a second credit. */
  idempotencyKey: string;
  /** EARN only; defaults to the standard expiry window. Pass null for a lot that never lapses. */
  expiresAt?: string | null;
}

export interface LedgerResult {
  applied: boolean;
  points: number;
  balance: number;
  alreadyApplied?: boolean;
}

/**
 * Credits points. The UNIQUE index on `idempotency_key` is the guard, not a preceding SELECT:
 * two concurrent retries would both pass a SELECT, but only one can win the INSERT.
 */
export async function creditPoints(db: Env['DB'], input: LedgerWrite): Promise<LedgerResult> {
  const points = Math.max(0, Math.round(input.points));
  if (points === 0) return { applied: false, points: 0, balance: await getBalance(db, input.customerId) };

  const expiresAt =
    input.expiresAt === undefined ? addMonths(new Date(), LOYALTY_RATES.EXPIRY_MONTHS) : input.expiresAt;

  const res = await db
    .prepare(`
      INSERT INTO loyalty_ledger (
        id, customer_id, entry_type, reason, points_delta, ref_type, ref_id, expires_at, note, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `)
    .bind(
      newId('lpt'),
      input.customerId,
      input.entryType,
      input.reason,
      points,
      input.refType ?? null,
      input.refId ?? null,
      input.entryType === 'EARN' ? expiresAt : null,
      input.note ?? null,
      input.idempotencyKey
    )
    .run();

  if (!((res as any)?.meta?.changes)) {
    return { applied: false, alreadyApplied: true, points: 0, balance: await getBalance(db, input.customerId) };
  }

  await rollupStatement(db, input.customerId).run();
  return { applied: true, points, balance: await getBalance(db, input.customerId) };
}

interface OpenLot {
  id: string;
  points_delta: number;
  points_consumed: number;
}

/** Open EARN lots, soonest-to-lapse first, then oldest first — the FIFO spend order. */
async function openLots(db: Env['DB'], customerId: string, onlyLapsed = false): Promise<OpenLot[]> {
  const { results } = await db
    .prepare(`
      SELECT id, points_delta, points_consumed
      FROM loyalty_ledger
      WHERE customer_id = ?
        AND entry_type = 'EARN'
        AND points_consumed < points_delta
        ${onlyLapsed ? 'AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP' : ''}
      ORDER BY expires_at IS NULL, expires_at ASC, created_at ASC
    `)
    .bind(customerId)
    .all<OpenLot>();
  return (results || []) as OpenLot[];
}

/**
 * Marks `points` as consumed across the customer's open lots. Purely expiry bookkeeping — the
 * balance has already moved via the ledger row — so a short allocation is not an error.
 */
function allocateAgainstLots(db: Env['DB'], lots: OpenLot[], points: number): any[] {
  const statements: any[] = [];
  let outstanding = points;
  for (const lot of lots) {
    if (outstanding <= 0) break;
    const spare = lot.points_delta - lot.points_consumed;
    if (spare <= 0) continue;
    const take = Math.min(spare, outstanding);
    outstanding -= take;
    statements.push(
      db.prepare('UPDATE loyalty_ledger SET points_consumed = points_consumed + ? WHERE id = ?').bind(take, lot.id)
    );
  }
  return statements;
}

/**
 * Debits points (a redemption, an expiry, a refund clawback). Writes the negative ledger row
 * first — that is the authoritative balance change — then allocates it across lots.
 *
 * `allowNegative` exists for refund clawbacks: if a shopper has already spent what a refunded
 * order earned, the ledger tells the truth and the balance goes negative rather than the
 * clawback silently evaporating. Redemption is separately gated on a positive balance.
 */
export async function debitPoints(
  db: Env['DB'],
  input: LedgerWrite & { allowNegative?: boolean }
): Promise<LedgerResult> {
  const requested = Math.max(0, Math.round(input.points));
  if (requested === 0) return { applied: false, points: 0, balance: await getBalance(db, input.customerId) };

  const balance = await getBalance(db, input.customerId);
  const points = input.allowNegative ? requested : Math.min(requested, Math.max(0, balance));
  if (points === 0) return { applied: false, points: 0, balance };

  const res = await db
    .prepare(`
      INSERT INTO loyalty_ledger (
        id, customer_id, entry_type, reason, points_delta, ref_type, ref_id, note, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `)
    .bind(
      newId('lpt'),
      input.customerId,
      input.entryType,
      input.reason,
      -points,
      input.refType ?? null,
      input.refId ?? null,
      input.note ?? null,
      input.idempotencyKey
    )
    .run();

  if (!((res as any)?.meta?.changes)) {
    return { applied: false, alreadyApplied: true, points: 0, balance };
  }

  const lots = await openLots(db, input.customerId);
  await db.batch([...allocateAgainstLots(db, lots, points), rollupStatement(db, input.customerId)]);

  return { applied: true, points, balance: balance - points };
}

export async function getBalance(db: Env['DB'], customerId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(points_delta), 0) AS balance FROM loyalty_ledger WHERE customer_id = ?')
    .bind(customerId)
    .first<{ balance: number }>();
  return Number(row?.balance || 0);
}

// ---------------------------------------------------------------------------------------------
// Lazy housekeeping — runs on read, because feature work cannot add a cron entry
// ---------------------------------------------------------------------------------------------

/**
 * Migrates the pre-ledger stub balance. `routes/customer.ts` has always written
 * `loyalty_points = 50` straight onto the row at signup with no ledger row behind it; without
 * this, that balance would be invisible to (and destroyed by) the first rollup recompute.
 */
async function backfillSignupBonus(db: Env['DB'], customer: LoyaltyCustomer): Promise<void> {
  const seen = await db
    .prepare('SELECT 1 AS x FROM loyalty_ledger WHERE customer_id = ? LIMIT 1')
    .bind(customer.id)
    .first<{ x: number }>();
  if (seen) return;

  const points = Number(customer.loyalty_points || 0) || LOYALTY_RATES.SIGNUP_BONUS_POINTS;
  await creditPoints(db, {
    customerId: customer.id,
    points,
    entryType: 'EARN',
    reason: 'SIGNUP_BONUS',
    refType: 'ADMIN',
    note: 'Welcome bonus',
    idempotencyKey: `loyalty:signup:${customer.id}`,
  });
}

/** Lapses every EARN lot past its expiry, clamped to the authoritative balance. */
async function expireLapsedPoints(db: Env['DB'], customerId: string): Promise<number> {
  const lapsed = await openLots(db, customerId, true);
  if (lapsed.length === 0) return 0;

  const balance = await getBalance(db, customerId);
  if (balance <= 0) return 0;

  const lapsedPoints = lapsed.reduce((sum, l) => sum + (l.points_delta - l.points_consumed), 0);
  const points = Math.min(lapsedPoints, balance);
  if (points <= 0) return 0;

  // Keyed on the oldest lapsed lot plus the amount, so a concurrent second pass is a no-op.
  const result = await debitPoints(db, {
    customerId,
    points,
    entryType: 'EXPIRE',
    reason: 'POINTS_EXPIRED',
    refType: 'LEDGER',
    refId: lapsed[0].id,
    note: `${points} points lapsed after ${LOYALTY_RATES.EXPIRY_MONTHS} months`,
    idempotencyKey: `loyalty:expire:${lapsed[0].id}:${points}`,
  });
  return result.applied ? result.points : 0;
}

/**
 * Gives back points held against an order that never got paid. Checkout deducts at order
 * creation (the same moment coupons increment `times_used`), so without this an abandoned
 * basket would quietly burn the shopper's balance.
 */
async function reclaimAbandonedRedemptions(db: Env['DB'], customerId: string): Promise<number> {
  const { results } = await db
    .prepare(`
      SELECT id, loyalty_points_redeemed
      FROM orders
      WHERE customer_id = ?
        AND status = 'PENDING_PAYMENT'
        AND loyalty_points_redeemed > 0
        AND created_at <= datetime('now', ?)
    `)
    .bind(customerId, `-${LOYALTY_RATES.REDEMPTION_HOLD_MINUTES} minutes`)
    .all<{ id: string; loyalty_points_redeemed: number }>();

  let restored = 0;
  for (const order of results || []) {
    const points = Number(order.loyalty_points_redeemed);
    const credited = await creditPoints(db, {
      customerId,
      points,
      entryType: 'ADJUST',
      reason: 'REDEEM_RECLAIMED',
      refType: 'ORDER',
      refId: order.id,
      note: 'Points returned — checkout was not completed',
      idempotencyKey: `loyalty:reclaim:${order.id}`,
      expiresAt: null, // returned points get a fresh lease rather than inheriting a stale one
    });
    if (!credited.applied) continue;

    // Re-assert PENDING_PAYMENT inside the UPDATE: the order may have been paid between the
    // SELECT above and here, in which case the hold must stand.
    await db
      .prepare(`
        UPDATE orders
        SET loyalty_points_redeemed = 0, loyalty_discount_cents = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING_PAYMENT'
      `)
      .bind(order.id)
      .run();
    restored += points;
  }
  return restored;
}

/**
 * The single "bring this customer up to date" entry point: backfill, expire, reclaim, retier.
 * Every read path and every redemption calls it first.
 */
export async function refreshCustomerLoyalty(db: Env['DB'], customerId: string): Promise<LoyaltyCustomer | null> {
  const customer = await db
    .prepare('SELECT id, email, loyalty_points, loyalty_tier FROM customers WHERE id = ?')
    .bind(customerId)
    .first<LoyaltyCustomer>();
  if (!customer) return null;

  await backfillSignupBonus(db, customer);
  await expireLapsedPoints(db, customerId);
  await reclaimAbandonedRedemptions(db, customerId);
  await refreshTier(db, customer);

  return await db
    .prepare('SELECT id, email, loyalty_points, loyalty_tier FROM customers WHERE id = ?')
    .bind(customerId)
    .first<LoyaltyCustomer>();
}

// ---------------------------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------------------------

/** Net merchandise spend on orders delivered in the trailing 12 months. */
export async function trailingSpendCents(db: Env['DB'], customerId: string, email: string): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COALESCE(SUM(subtotal_cents - discount_cents), 0) AS spend
      FROM orders
      WHERE (customer_id = ? OR customer_email = ?)
        AND status = 'DELIVERED'
        AND created_at >= datetime('now', '-12 months')
    `)
    .bind(customerId, email)
    .first<{ spend: number }>();
  return Number(row?.spend || 0);
}

export function tierForSpend(spendCents: number): LoyaltyTier {
  let tier: LoyaltyTier = 'BRONZE';
  for (const candidate of TIER_ORDER) {
    if (spendCents >= LOYALTY_RATES.TIER_THRESHOLDS_CENTS[candidate]) tier = candidate;
  }
  return tier;
}

export function describeTier(tier: LoyaltyTier, spendCents: number): LoyaltyTierInfo {
  const next = TIER_ORDER[TIER_ORDER.indexOf(tier) + 1] ?? null;
  return {
    tier,
    trailing_spend_cents: spendCents,
    next_tier: next,
    cents_to_next_tier: next ? Math.max(0, LOYALTY_RATES.TIER_THRESHOLDS_CENTS[next] - spendCents) : 0,
    earn_multiplier: LOYALTY_RATES.TIER_MULTIPLIERS[tier],
    perks: TIER_PERK_LABELS[tier],
  };
}

/**
 * Recomputes the tier and issues its consumable perks as entitlement grants.
 *
 * `grantEntitlement` has no idempotency of its own (only consume/release do), so the guard is
 * here: every tier grant carries a deterministic `source_id` of `<customerId>:<tier>:<year>`
 * and is skipped when an ACTIVE grant with that id already exists. Without it, every delivery
 * would mint another free-shipping grant.
 */
export async function refreshTier(db: Env['DB'], customer: LoyaltyCustomer): Promise<LoyaltyTierInfo> {
  const spend = await trailingSpendCents(db, customer.id, customer.email);
  const tier = tierForSpend(spend);

  if (tier !== customer.loyalty_tier) {
    await db
      .prepare('UPDATE customers SET loyalty_tier = ?, loyalty_tier_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(tier, customer.id)
      .run();
  }

  const year = new Date().getUTCFullYear();
  const existing = await listActiveGrants(db, customer.id);
  for (const code of TIER_ENTITLEMENTS[tier]) {
    const sourceId = `${customer.id}:${tier}:${year}`;
    const already = existing.some(
      (g) => g.entitlement_code === code && g.source_type === 'LOYALTY_TIER' && g.source_id === sourceId
    );
    if (already) continue;

    await grantEntitlement(db, {
      customerId: customer.id,
      code,
      totalUnits: -1, // unlimited within the window — a tier perk is a standing benefit
      sourceType: 'LOYALTY_TIER',
      sourceId,
      expiresAt: addMonths(new Date(), 12),
      notes: `${tier} tier perk`,
    });
  }

  return describeTier(tier, spend);
}

// ---------------------------------------------------------------------------------------------
// Summary & statement
// ---------------------------------------------------------------------------------------------

export async function getSummary(db: Env['DB'], customerId: string): Promise<LoyaltySummary | null> {
  const customer = await refreshCustomerLoyalty(db, customerId);
  if (!customer) return null;

  const spend = await trailingSpendCents(db, customer.id, customer.email);
  const soon = await db
    .prepare(`
      SELECT COALESCE(SUM(points_delta - points_consumed), 0) AS points, MIN(expires_at) AS soonest
      FROM loyalty_ledger
      WHERE customer_id = ?
        AND entry_type = 'EARN'
        AND points_consumed < points_delta
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now', ?)
    `)
    .bind(customerId, `+${LOYALTY_RATES.EXPIRY_WARNING_DAYS} days`)
    .first<{ points: number; soonest: string | null }>();

  const balance = Number(customer.loyalty_points || 0);
  return {
    balance,
    lifetime_points: await lifetimePoints(db, customerId),
    tier: describeTier(customer.loyalty_tier, spend),
    // Never promise more expiring than the balance can actually lose.
    expiring_soon_points: Math.max(0, Math.min(Number(soon?.points || 0), balance)),
    expiring_soon_at: soon?.soonest || null,
    point_value_cents: LOYALTY_RATES.POINT_VALUE_CENTS,
  };
}

async function lifetimePoints(db: Env['DB'], customerId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(points_delta), 0) AS n FROM loyalty_ledger WHERE customer_id = ? AND points_delta > 0')
    .bind(customerId)
    .first<{ n: number }>();
  return Number(row?.n || 0);
}

export async function getStatement(
  db: Env['DB'],
  customerId: string,
  limit = 50,
  offset = 0
): Promise<LoyaltyLedgerEntry[]> {
  const { results } = await db
    .prepare(`
      SELECT id, entry_type, reason, points_delta, ref_type, ref_id, expires_at, note, created_at
      FROM loyalty_ledger
      WHERE customer_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ? OFFSET ?
    `)
    .bind(customerId, Math.min(200, Math.max(1, limit)), Math.max(0, offset))
    .all<LoyaltyLedgerEntry>();
  return (results || []) as LoyaltyLedgerEntry[];
}

// ---------------------------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------------------------

/**
 * How much of this basket points can cover. `subtotalCents` must already have any coupon
 * deducted, otherwise coupon + points together could exceed the value of the order.
 */
export async function previewRedemption(
  db: Env['DB'],
  customerId: string,
  subtotalCents: number
): Promise<LoyaltyRedemptionPreview> {
  const customer = await refreshCustomerLoyalty(db, customerId);
  const balance = Math.max(0, Number(customer?.loyalty_points || 0));

  const capCents = Math.floor((Math.max(0, subtotalCents) * LOYALTY_RATES.MAX_REDEEM_PERCENT) / 100);
  const capPoints = Math.floor(capCents / LOYALTY_RATES.POINT_VALUE_CENTS);
  const maxPoints = Math.min(balance, capPoints);

  const base = {
    balance,
    min_points: LOYALTY_RATES.MIN_REDEEM_POINTS,
    cap_percent: LOYALTY_RATES.MAX_REDEEM_PERCENT,
    point_value_cents: LOYALTY_RATES.POINT_VALUE_CENTS,
  };

  if (balance < LOYALTY_RATES.MIN_REDEEM_POINTS) {
    return {
      ...base,
      eligible: false,
      reason: `You need at least ${LOYALTY_RATES.MIN_REDEEM_POINTS} points to redeem`,
      max_points: 0,
      max_discount_cents: 0,
    };
  }
  if (maxPoints < LOYALTY_RATES.MIN_REDEEM_POINTS) {
    return {
      ...base,
      eligible: false,
      reason: `This order is too small to redeem points against (up to ${LOYALTY_RATES.MAX_REDEEM_PERCENT}% of an order can be paid with points)`,
      max_points: 0,
      max_discount_cents: 0,
    };
  }

  return { ...base, eligible: true, max_points: maxPoints, max_discount_cents: pointsToCents(maxPoints) };
}

export interface RedeemResult {
  success: boolean;
  error?: string;
  points: number;
  discountCents: number;
  /** Ledger writes for the caller to batch alongside its own — see `prepareOrderRedemption`. */
  statements: any[];
}

/**
 * Validates a redemption and returns the ledger writes, rather than performing them.
 *
 * Checkout has to insert the order, its items and the redemption in one `db.batch` — an order
 * that exists with a points discount but no matching debit is free money, and a debit with no
 * order is a stolen balance. Returning statements is the only way to get both into one batch,
 * since D1 has no cross-statement transaction.
 */
export async function prepareOrderRedemption(
  db: Env['DB'],
  customerId: string,
  orderId: string,
  requestedPoints: number,
  subtotalAfterCouponCents: number
): Promise<RedeemResult> {
  const preview = await previewRedemption(db, customerId, subtotalAfterCouponCents);
  if (!preview.eligible) {
    return { success: false, error: preview.reason, points: 0, discountCents: 0, statements: [] };
  }

  const points = Math.min(Math.floor(requestedPoints), preview.max_points);
  if (points < LOYALTY_RATES.MIN_REDEEM_POINTS) {
    return {
      success: false,
      error: `Minimum redemption is ${LOYALTY_RATES.MIN_REDEEM_POINTS} points`,
      points: 0,
      discountCents: 0,
      statements: [],
    };
  }

  const lots = await openLots(db, customerId);
  const statements = [
    // The UNIQUE key means a retried checkout for the same order cannot debit twice, even
    // though this statement is composed rather than executed here.
    db
      .prepare(`
        INSERT INTO loyalty_ledger (
          id, customer_id, entry_type, reason, points_delta, ref_type, ref_id, note, idempotency_key
        ) VALUES (?, ?, 'REDEEM', 'ORDER_REDEEM', ?, 'ORDER', ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `)
      .bind(newId('lpt'), customerId, -points, orderId, 'Redeemed against your order', `loyalty:redeem:${orderId}`),
    ...allocateAgainstLots(db, lots, points),
    rollupStatement(db, customerId),
  ];

  return { success: true, points, discountCents: pointsToCents(points), statements };
}

// ---------------------------------------------------------------------------------------------
// Earning — called from hooks/loyalty.ts and routes/loyalty.ts
// ---------------------------------------------------------------------------------------------

/** Base accrual for a delivered order, at the customer's tier multiplier. */
export async function awardForDeliveredOrder(
  db: Env['DB'],
  customer: LoyaltyCustomer,
  order: { id: string; subtotal_cents: number; discount_cents: number }
): Promise<number> {
  const net = Number(order.subtotal_cents || 0) - Number(order.discount_cents || 0);
  const points = pointsForSpend(net, customer.loyalty_tier);
  if (points <= 0) return 0;

  const result = await creditPoints(db, {
    customerId: customer.id,
    points,
    entryType: 'EARN',
    reason: 'ORDER_DELIVERED',
    refType: 'ORDER',
    refId: order.id,
    note: 'Points for a delivered order',
    idempotencyKey: `loyalty:earn:${order.id}`,
  });
  return result.applied ? result.points : 0;
}

/**
 * Streak bonus for subscribers. Paid on every Nth delivered order while a subscription is
 * ACTIVE; the milestone count comes from the delivered-order count itself, so a retried hook
 * lands on the same milestone and the idempotency key absorbs it.
 */
export async function awardSubscriptionStreak(
  db: Env['DB'],
  customer: LoyaltyCustomer,
  orderId: string
): Promise<number> {
  const sub = await db
    .prepare(`SELECT 1 AS x FROM subscriptions WHERE (customer_id = ? OR customer_email = ?) AND status = 'ACTIVE' LIMIT 1`)
    .bind(customer.id, customer.email)
    .first<{ x: number }>();
  if (!sub) return 0;

  const row = await db
    .prepare(`
      SELECT COUNT(*) AS n FROM orders
      WHERE (customer_id = ? OR customer_email = ?) AND status = 'DELIVERED'
    `)
    .bind(customer.id, customer.email)
    .first<{ n: number }>();
  const delivered = Number(row?.n || 0);
  if (delivered === 0 || delivered % LOYALTY_RATES.SUBSCRIPTION_STREAK_EVERY !== 0) return 0;

  const result = await creditPoints(db, {
    customerId: customer.id,
    points: LOYALTY_RATES.SUBSCRIPTION_STREAK_POINTS,
    entryType: 'EARN',
    reason: 'SUBSCRIPTION_STREAK',
    refType: 'ORDER',
    refId: orderId,
    note: `Subscription streak — ${delivered} deliveries`,
    idempotencyKey: `loyalty:streak:${customer.id}:${delivered}`,
  });
  return result.applied ? result.points : 0;
}

// ---------------------------------------------------------------------------------------------
// Refund reversal
// ---------------------------------------------------------------------------------------------

/**
 * Unwinds an order: claws back what it earned and gives back what it redeemed. The clawback is
 * allowed to drive the balance negative — the ledger records what actually happened, and
 * redemption is gated on a positive balance elsewhere.
 */
export async function reverseOrder(
  db: Env['DB'],
  customerId: string,
  orderId: string
): Promise<{ clawedBack: number; restored: number }> {
  const { results } = await db
    .prepare(`
      SELECT points_delta, reason FROM loyalty_ledger
      WHERE customer_id = ? AND ref_type = 'ORDER' AND ref_id = ?
    `)
    .bind(customerId, orderId)
    .all<{ points_delta: number; reason: string }>();

  const earned = (results || [])
    .filter((r) => r.points_delta > 0 && r.reason !== 'REDEEM_RECLAIMED')
    .reduce((sum, r) => sum + Number(r.points_delta), 0);
  const redeemed = (results || [])
    .filter((r) => r.reason === 'ORDER_REDEEM')
    .reduce((sum, r) => sum + Math.abs(Number(r.points_delta)), 0);

  let clawedBack = 0;
  if (earned > 0) {
    const res = await debitPoints(db, {
      customerId,
      points: earned,
      entryType: 'ADJUST',
      reason: 'REFUND_CLAWBACK',
      refType: 'ORDER',
      refId: orderId,
      note: 'Points reversed — order refunded',
      idempotencyKey: `loyalty:clawback:${orderId}`,
      allowNegative: true,
    });
    clawedBack = res.applied ? res.points : 0;
  }

  let restored = 0;
  if (redeemed > 0) {
    const res = await creditPoints(db, {
      customerId,
      points: redeemed,
      entryType: 'ADJUST',
      reason: 'REFUND_RESTORE',
      refType: 'ORDER',
      refId: orderId,
      note: 'Redeemed points returned — order refunded',
      idempotencyKey: `loyalty:restore:${orderId}`,
      expiresAt: null,
    });
    restored = res.applied ? res.points : 0;
  }

  return { clawedBack, restored };
}
