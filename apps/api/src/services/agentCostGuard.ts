import type { Env } from '../types/env';

/**
 * Per-session daily cost cap for Maya.
 *
 * Groq charges per token. With max_tokens = 1024 (services/groq.ts) and a tool
 * turn, a single request can call the model twice — once to decide on a tool
 * and once to write the user-facing reply — so a runaway loop or a bored
 * customer mashing the send button is a real bill, not a hypothetical one.
 *
 * This guard is deliberately simple and best-effort: a coarse USD counter
 * keyed by session_token + UTC day, kept in CONFIG_KV (the same KV the rate
 * limiter uses) and incremented by an estimated cents value. The estimate is
 * intentionally conservative — `prompt_tokens + completion_tokens` mapped to
 * a flat cents-per-1k — so a few rounding errors always err on the safe side.
 *
 * The guard NEVER refuses an unauthenticated request (no session_token) and
 * NEVER refuses when KV is unbound (dev). The two failure modes are:
 *
 *   1. budget exceeded  → 429 with retry-after, identical to the rate limit
 *   2. KV read failed   → silent pass-through, like the rate limiter's fall-
 *      back to its in-memory store. Cost guard is best-effort defence in depth.
 */

const MAX_DAILY_CENTS_PER_SESSION = 50;
const USD_CENTS_PER_1K_TOKENS = 30;

function dailyKvKey(sessionToken: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `agent_cost:${sessionToken}:${day}`;
}

interface BudgetOutcome {
  /** True when the call may proceed. */
  ok: boolean;
  /** Approximate cents spent today after this call (only meaningful when ok). */
  spentTodayCents: number;
  /** 0..1 utilisation so the caller can surface a soft warning. */
  utilisation: number;
  /** When the daily window rolls over. */
  resetAt: Date;
}

function resetAt(now: Date = new Date()): Date {
  const r = new Date(now);
  r.setUTCHours(24, 0, 0, 0);
  return r;
}

async function readBudget(
  kv: any,
  sessionToken: string
): Promise<{ spent: number; resetAt: Date }> {
  const key = dailyKvKey(sessionToken);
  let spent = 0;
  if (kv && typeof kv.get === 'function') {
    try {
      const raw = await kv.get(key);
      spent = raw ? Number(raw) : 0;
    } catch (err) {
      console.warn('[costGuard] KV read failed, allowing request:', err);
    }
  }
  return { spent, resetAt: resetAt() };
}

/**
 * Reserves budget for one turn (pass 1 + pass 2) and returns whether the call
 * may proceed. Always reserves the conservative upper-bound estimate rather
 * than waiting on the actual token count — that keeps a long reply from
 * overshooting the cap after the model has already streamed the whole thing.
 */
export async function checkAndReserveSessionBudget(
  env: Pick<Env, 'CONFIG_KV'>,
  sessionToken: string | null | undefined,
  estimatedTokens: number
): Promise<BudgetOutcome> {
  if (!sessionToken) {
    return { ok: true, spentTodayCents: 0, utilisation: 0, resetAt: resetAt() };
  }
  const kv = env.CONFIG_KV;
  const { spent } = await readBudget(kv, sessionToken);

  const estimatedCents = Math.max(1, Math.round((estimatedTokens * USD_CENTS_PER_1K_TOKENS) / 1000));
  const projected = spent + estimatedCents;

  if (projected > MAX_DAILY_CENTS_PER_SESSION) {
    return {
      ok: false,
      spentTodayCents: spent,
      utilisation: spent / MAX_DAILY_CENTS_PER_SESSION,
      resetAt: resetAt(),
    };
  }

  if (kv && typeof kv.put === 'function') {
    try {
      await kv.put(dailyKvKey(sessionToken), String(projected), {
        // TTL of 26 hours covers the longest possible UTC-day boundary.
        expirationTtl: 26 * 60 * 60,
      });
    } catch (err) {
      console.warn('[costGuard] KV write failed, allowing request:', err);
    }
  }

  return {
    ok: true,
    spentTodayCents: projected,
    utilisation: projected / MAX_DAILY_CENTS_PER_SESSION,
    resetAt: resetAt(),
  };
}

/** Exported so tests and the live-verify script can drive the cap deterministically. */
export const DAILY_CAP_CENTS = MAX_DAILY_CENTS_PER_SESSION;
export const COST_GUARD_USD_CENTS_PER_1K = USD_CENTS_PER_1K_TOKENS;
