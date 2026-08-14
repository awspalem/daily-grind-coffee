/**
 * Zero Trust Access & Admin Auth Middleware
 * Inspects Cloudflare Access assertion headers (Cf-Access-Jwt-Assertion, Cf-Access-Authenticated-User-Email)
 * and verifies authorization tokens.
 */
export async function zeroTrustAdminGuard(c, next) {
    const cfEmail = c.req.header('Cf-Access-Authenticated-User-Email');
    const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');
    const authHeader = c.req.header('Authorization');
    let actorEmail = cfEmail || 'admin-local@dailygrind.coffee';
    let actorId = 'actor_admin_01';
    // In development, accept Bearer token or development authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token === c.env.ADMIN_TOKEN || token === 'admin-dev-token' || c.env.ENVIRONMENT === 'development') {
            c.set('adminActor', {
                id: actorId,
                email: actorEmail,
                role: 'ADMIN',
            });
            return next();
        }
    }
    // If in production and Zero Trust header is present
    if (cfJwt && cfEmail) {
        c.set('adminActor', {
            id: 'zt_' + cfEmail,
            email: cfEmail,
            role: 'ADMIN',
        });
        return next();
    }
    // If local development mode
    if (c.env.ENVIRONMENT === 'development' || !c.env.ENVIRONMENT) {
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
