import type { Env } from '../types/env';

export interface StoredAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns of context restored on load. Matches the client's own in-memory cap (main.ts). */
const HISTORY_LIMIT = 20;

/** Rows kept per session before older ones are pruned. Roughly 20 back-and-forth turns. */
const MAX_STORED_PER_SESSION = 40;

export type AgentActorType = 'customer' | 'admin';

export interface SaveAgentTurnOpts {
  sessionToken: string;
  customerId?: string | null;
  userContent: string;
  assistantContent: string;
  /** Defaults to 'customer'. Admin turns are keyed by the admin user id in `actorId`. */
  actorType?: AgentActorType;
  /** Required when actorType is 'admin' — usually the zeroTrustAdminGuard actor id. */
  actorId?: string | null;
}

export interface LoadAgentHistoryOpts {
  sessionToken: string;
  actorType?: AgentActorType;
  actorId?: string | null;
}

/**
 * Saves one turn. Best-effort: persisting history is an enhancement on top of a chat that
 * already works without it, so a D1 failure here is logged and swallowed rather than surfaced —
 * it must never turn a working reply into a failed request.
 */
async function insertMessage(
  db: Env['DB'],
  opts: { sessionToken: string; customerId?: string | null; role: 'user' | 'assistant'; content: string; actorType: AgentActorType; actorId?: string | null }
): Promise<void> {
  if (!opts.content || !opts.content.trim()) return;
  await db
    .prepare('INSERT INTO agent_messages (id, session_token, customer_id, role, content, actor_type, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      'am_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20),
      opts.sessionToken,
      opts.customerId || null,
      opts.role,
      opts.content,
      opts.actorType,
      opts.actorId || null
    )
    .run();
}

/**
 * Saves a completed turn — the user's message and Maya's reply together, in one call, after the
 * reply is known. Deliberately not two independent saves around the Groq call: a turn split
 * across a save-before/save-after would leave a dangling, reply-less user message in history
 * whenever the model call failed or the client disconnected mid-reply, and that half-turn would
 * then be replayed to Groq as history on the next message, producing two consecutive user turns.
 *
 * Also prunes anything past MAX_STORED_PER_SESSION for this session, so a session_token that
 * never expires (it lives in localStorage) doesn't grow the table forever.
 */
export async function saveAgentTurn(
  db: Env['DB'],
  opts: SaveAgentTurnOpts
): Promise<void> {
  if (!opts.sessionToken) return;
  const actorType: AgentActorType = opts.actorType || 'customer';
  try {
    await insertMessage(db, {
      sessionToken: opts.sessionToken,
      customerId: opts.customerId,
      role: 'user',
      content: opts.userContent,
      actorType,
      actorId: opts.actorId,
    });
    await insertMessage(db, {
      sessionToken: opts.sessionToken,
      customerId: opts.customerId,
      role: 'assistant',
      content: opts.assistantContent,
      actorType,
      actorId: opts.actorId,
    });
    // Per-actor pruning: an admin's chat and a customer's chat share the same
    // session_token namespace only by accident (admin never sets a real
    // session_token; the SPA passes a stable per-admin id). Pruning the
    // session_token namespace is still safe because we filter by actor_type.
    await db
      .prepare(
        `DELETE FROM agent_messages
          WHERE session_token = ?
            AND actor_type = ?
            AND id NOT IN (
              SELECT id FROM agent_messages WHERE session_token = ? AND actor_type = ? ORDER BY created_at DESC LIMIT ?
            )`
      )
      .bind(opts.sessionToken, actorType, opts.sessionToken, actorType, MAX_STORED_PER_SESSION)
      .run();
  } catch (err) {
    console.error('[agent] failed to persist conversation turn, continuing:', err);
  }
}

/**
 * Restores the last turns of a conversation. For customer chats, scoped to the
 * browser session_token (not merged across a signed-in customer's other
 * devices — see the original docstring). For admin chats, scoped to both
 * session_token and actor_id so the two audiences never interleave.
 * Returns oldest-first, ready to feed straight into the chat UI.
 */
export async function loadAgentHistory(
  db: Env['DB'],
  opts: LoadAgentHistoryOpts
): Promise<StoredAgentMessage[]> {
  if (!opts.sessionToken) return [];
  const actorType: AgentActorType = opts.actorType || 'customer';
  try {
    // customer rows are the historical default and may have NULL actor_id; an
    // admin load always carries one. The two predicates are mutually
    // exclusive because admin turns are written with actor_type='admin'.
    const sql = actorType === 'admin'
      ? `SELECT role, content FROM agent_messages
         WHERE session_token = ? AND actor_type = 'admin' AND actor_id = ?
         ORDER BY created_at DESC LIMIT ?`
      : `SELECT role, content FROM agent_messages
         WHERE session_token = ? AND actor_type = 'customer'
         ORDER BY created_at DESC LIMIT ?`;
    const bind = actorType === 'admin'
      ? [opts.sessionToken, opts.actorId || '', HISTORY_LIMIT]
      : [opts.sessionToken, HISTORY_LIMIT];
    const { results } = await db.prepare(sql).bind(...(bind as any)).all<StoredAgentMessage>();
    return (results || []).reverse();
  } catch (err) {
    console.error('[agent] failed to load history, continuing without it:', err);
    return [];
  }
}
