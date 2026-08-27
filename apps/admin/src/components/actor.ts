/**
 * Client-side role / actor helper.
 *
 * The /api/admin/* surface is gated server-side by zeroTrustAdminGuard and
 * every endpoint is hard-wired to record audit log entries with the resolved
 * actor. The actor's role is currently always 'ADMIN' on the server (see
 * middleware/zeroTrust.ts) — there's no plumbing yet to expose it back to
 * the SPA.
 *
 * Until a /api/admin/me endpoint exists, this module exposes a `getActor()`
 * helper that:
 *   - returns whatever `localStorage` says, if the test/dev console has set
 *     a simulated role (e.g. `setActorRole('SUPPORT')`)
 *   - falls back to 'ADMIN' as the safe default — every feature already
 *     requires admin auth, so the absence of role info is a permit, not a
 *     deny.
 *
 * Feature files should call `requireRole('ADMIN', 'Save changes')` to gate
 * sensitive UI. The helper is a no-op today and a no-op when the actor is
 * 'ADMIN', but it will start hiding the action as soon as SUPPORT /
 * ROASTER roles can be resolved from a real session.
 */
import { toast } from '../features/shared';

export type AdminRole = 'ADMIN' | 'ROASTER' | 'SUPPORT';

const ROLE_KEY = 'admin.override.role';

let cachedRole: AdminRole | null = null;

function readRole(): AdminRole {
  if (cachedRole) return cachedRole;
  try {
    const stored = localStorage.getItem(ROLE_KEY) as AdminRole | null;
    if (stored === 'ADMIN' || stored === 'ROASTER' || stored === 'SUPPORT') {
      cachedRole = stored;
      return stored;
    }
  } catch {
    // localStorage can throw in some privacy modes; fall through to default
  }
  cachedRole = 'ADMIN';
  return cachedRole;
}

export function getActor(): { role: AdminRole } {
  return { role: readRole() };
}

export function setActorRole(role: AdminRole | null): void {
  cachedRole = null;
  try {
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Returns true if the current actor is allowed to perform an action
 * reserved for one of `allowed` roles. If denied, emits a toast explaining
 * the requirement so the operator understands why the button is dead.
 */
export function requireRole(allowed: AdminRole | AdminRole[], actionLabel: string): boolean {
  const { role } = getActor();
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (list.includes(role)) return true;
  const required = list.join(' / ');
  toast(`${actionLabel} requires the ${required} role. Your session is ${role}.`, 'error', 4500);
  return false;
}
