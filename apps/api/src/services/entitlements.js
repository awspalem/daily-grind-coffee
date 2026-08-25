/**
 * Every time comparison wraps both sides in `datetime()`.
 *
 * The columns hold two formats: rows inserted without an explicit value take the column default
 * `CURRENT_TIMESTAMP` (`2026-08-25 21:05:00`), while `grantPlanEntitlements` binds an ISO string
 * from `Date#toISOString` (`2026-08-25T21:05:00.000Z`). SQLite compares those as plain text, and
 * `'T'` sorts above `' '` — so a grant issued *now* with an ISO `starts_at` failed
 * `starts_at <= CURRENT_TIMESTAMP` and stayed invisible until the next midnight UTC. An annual
 * member's consultations have to be spendable the moment they pay for them.
 *
 * `datetime()` parses both forms and emits one, so the comparison is on instants, not on text.
 */
const ACTIVE_GRANT_SQL = `
  SELECT * FROM entitlement_grants
  WHERE customer_id = ?
    AND status = 'ACTIVE'
    AND datetime(starts_at) <= datetime('now')
    AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
`;
function newId(prefix) {
    return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
/** Every currently-usable grant for a customer, optionally narrowed to one code. */
export async function listActiveGrants(db, customerId, code) {
    const sql = ACTIVE_GRANT_SQL + (code ? ' AND entitlement_code = ?' : '') + " ORDER BY expires_at IS NULL, datetime(expires_at) ASC";
    const stmt = code ? db.prepare(sql).bind(customerId, code) : db.prepare(sql).bind(customerId);
    const { results } = await stmt.all();
    return (results || []);
}
/** Balances grouped by entitlement code, for the account page and the checkout perks strip. */
export async function getBalances(db, customerId) {
    const grants = await listActiveGrants(db, customerId);
    const byCode = new Map();
    for (const g of grants) {
        const list = byCode.get(g.entitlement_code) || [];
        list.push(g);
        byCode.set(g.entitlement_code, list);
    }
    return Array.from(byCode.entries()).map(([entitlement_code, list]) => {
        const unlimited = list.some((g) => g.total_units === -1);
        const remaining = unlimited
            ? -1
            : list.reduce((sum, g) => sum + Math.max(0, g.total_units - g.used_units), 0);
        const expiries = list.map((g) => g.expires_at).filter((e) => !!e).sort();
        return {
            entitlement_code,
            remaining_units: remaining,
            unlimited,
            next_expiry: expiries[0] || null,
            grants: list,
        };
    });
}
/** True when the customer can currently spend `units` of `code`. */
export async function hasEntitlement(db, customerId, code, units = 1) {
    const grants = await listActiveGrants(db, customerId, code);
    if (grants.some((g) => g.total_units === -1))
        return true;
    const remaining = grants.reduce((sum, g) => sum + Math.max(0, g.total_units - g.used_units), 0);
    return remaining >= units;
}
/** Issues a new bucket of units. Used by plan purchase/renewal and by admin adjustments. */
export async function grantEntitlement(db, input) {
    const id = newId('ent');
    await db
        .prepare(`
      INSERT INTO entitlement_grants (
        id, customer_id, entitlement_code, source_type, source_id,
        total_units, used_units, starts_at, expires_at, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), ?, 'ACTIVE', ?)
    `)
        .bind(id, input.customerId, input.code, input.sourceType, input.sourceId ?? null, input.totalUnits, input.startsAt ?? null, input.expiresAt ?? null, input.notes ?? null)
        .run();
    const grant = await db.prepare('SELECT * FROM entitlement_grants WHERE id = ?').bind(id).first();
    return grant;
}
/**
 * Spends units across the customer's grants, soonest-to-expire first. Returns
 * `{ success: false }` rather than throwing when the balance is short, so callers can fall back
 * to charging for the booking instead.
 */
export async function consumeEntitlement(db, input) {
    const units = input.units ?? 1;
    const existing = await db
        .prepare('SELECT grant_id FROM entitlement_ledger WHERE idempotency_key = ?')
        .bind(input.idempotencyKey)
        .first();
    if (existing) {
        return { success: true, grant_ids: [existing.grant_id], already_applied: true };
    }
    const grants = await listActiveGrants(db, input.customerId, input.code);
    const unlimited = grants.find((g) => g.total_units === -1);
    if (unlimited) {
        await db
            .prepare(`
        INSERT INTO entitlement_ledger (id, grant_id, customer_id, entitlement_code, delta_units, reason, ref_type, ref_id, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
            .bind(newId('entl'), unlimited.id, input.customerId, input.code, -units, input.reason, input.refType ?? null, input.refId ?? null, input.idempotencyKey)
            .run();
        return { success: true, grant_ids: [unlimited.id] };
    }
    const available = grants.reduce((sum, g) => sum + Math.max(0, g.total_units - g.used_units), 0);
    if (available < units) {
        return { success: false, error: `Insufficient ${input.code} entitlement (need ${units}, have ${available})` };
    }
    let outstanding = units;
    const touched = [];
    const statements = [];
    for (const grant of grants) {
        if (outstanding <= 0)
            break;
        const spare = Math.max(0, grant.total_units - grant.used_units);
        if (spare <= 0)
            continue;
        const take = Math.min(spare, outstanding);
        outstanding -= take;
        touched.push(grant.id);
        statements.push(db
            .prepare(`
          INSERT INTO entitlement_ledger (id, grant_id, customer_id, entitlement_code, delta_units, reason, ref_type, ref_id, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
            .bind(newId('entl'), grant.id, input.customerId, input.code, -take, input.reason, input.refType ?? null, input.refId ?? null, 
        // Only the first statement carries the caller's key; the UNIQUE index allows one row
        // per key, and later rows in the same spend get a derived suffix.
        touched.length === 1 ? input.idempotencyKey : `${input.idempotencyKey}:${touched.length}`), db
            .prepare(`
          UPDATE entitlement_grants
          SET used_units = used_units + ?,
              status = CASE WHEN used_units + ? >= total_units THEN 'EXHAUSTED' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
            .bind(take, take, grant.id));
    }
    await db.batch(statements);
    return { success: true, grant_ids: touched };
}
/**
 * Puts units back — a cancelled booking inside the policy window, or a refunded order. Reopens
 * a grant that had been marked EXHAUSTED.
 */
export async function releaseEntitlement(db, input) {
    const units = input.units ?? 1;
    const existing = await db
        .prepare('SELECT grant_id FROM entitlement_ledger WHERE idempotency_key = ?')
        .bind(input.idempotencyKey)
        .first();
    if (existing)
        return { success: true, grant_ids: [existing.grant_id], already_applied: true };
    await db.batch([
        db
            .prepare(`
        INSERT INTO entitlement_ledger (id, grant_id, customer_id, entitlement_code, delta_units, reason, ref_type, ref_id, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
            .bind(newId('entl'), input.grantId, input.customerId, input.code, units, input.reason, input.refType ?? null, input.refId ?? null, input.idempotencyKey),
        db
            .prepare(`
        UPDATE entitlement_grants
        SET used_units = MAX(0, used_units - ?),
            status = CASE WHEN status = 'EXHAUSTED' THEN 'ACTIVE' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(units, input.grantId),
    ]);
    return { success: true, grant_ids: [input.grantId] };
}
/** Marks lapsed grants EXPIRED. Called from the daily cron alongside the other housekeeping. */
export async function expireStaleGrants(db) {
    const res = await db
        .prepare(`
      UPDATE entitlement_grants
      SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')
    `)
        .run();
    return res?.meta?.changes ?? 0;
}
