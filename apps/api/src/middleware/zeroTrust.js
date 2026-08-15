/**
 * Zero Trust Access & Admin Auth Middleware
 * Inspects Cloudflare Access assertion headers (Cf-Access-Jwt-Assertion, Cf-Access-Authenticated-User-Email)
 * and verifies authorization tokens.
 */
export async function zeroTrustAdminGuard(c, next) {
    const cfEmail = c.req.header('Cf-Access-Authenticated-User-Email');
    const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');
    const authHeader = c.req.header('Authorization');
    const actorEmail = cfEmail || 'admin-local@dailygrind.coffee';
    const actorId = 'actor_admin_01';
    const isProduction = c.env.ENVIRONMENT === 'production';
    // Primary path: Cloudflare Access has already verified the user and forwarded a signed JWT.
    if (cfJwt && cfEmail) {
        c.set('adminActor', {
            id: 'zt_' + cfEmail,
            email: cfEmail,
            role: 'ADMIN',
        });
        return next();
    }
    // Fallback: a pre-shared bearer token, for local tooling/scripts. Only ever trusted when a
    // real ADMIN_TOKEN secret is configured — never a hardcoded literal, and never in production
    // (production must go through Cloudflare Access above).
    if (!isProduction && authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN) {
            c.set('adminActor', {
                id: actorId,
                email: actorEmail,
                role: 'ADMIN',
            });
            return next();
        }
    }
    // Non-production with no ADMIN_TOKEN configured at all: allow through for local dev only.
    if (!isProduction && !c.env.ADMIN_TOKEN) {
        c.set('adminActor', {
            id: 'local_dev_admin',
            email: 'roaster@dailygrind.coffee',
            role: 'ADMIN',
        });
        return next();
    }
    return c.json({
        success: false,
        error: 'Access Denied: Protected by Cloudflare Zero Trust Access authentication.',
    }, 401);
}
/**
 * Audit Logging Helper
 * Writes privileged admin changes to D1 audit_log
 */
export async function recordAuditLog(db, actor, action, entityType, entityId, oldVal, newVal, ip) {
    const id = 'aud_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await db.prepare(`
    INSERT INTO audit_log (
      id, actor_id, actor_email, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(id, actor.id, actor.email, action, entityType, entityId, oldVal ? JSON.stringify(oldVal) : null, newVal ? JSON.stringify(newVal) : null, ip || null).run();
}
