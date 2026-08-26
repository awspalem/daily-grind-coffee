import type { Env } from '../types/env';

export interface StoredAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns of context restored on load. Matches the client's own in-memory cap (main.ts). */
const HISTORY_LIMIT = 20;

/** Rows kept per session before older ones are pruned. Roughly 20 back-and-forth turns. */
const MAX_STORED_PER_SESSION = 40;

/**
 * Saves one turn. Best-effort: persisting history is an enhancement on top of a chat that
 * already works without it, so a D1 failure here is logged and swallowed rather than surfaced —
 * it must never turn a working reply into a failed request.
 */
async function insertMessage(
  db: Env['DB'],
  opts: { sessionToken: string; customerId?: string | null; role: 'user' | 'assistant'; content: string }
): Promise<void> {
  if (!opts.content || !opts.content.trim()) return;
  await db
    .prepare('INSERT INTO agent_messages (id, session_token, customer_id, role, content) VALUES (?, ?, ?, ?, ?)')
    .bind(
      'am_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20),
      opts.sessionToken,
      opts.customerId || null,
      opts.role,
      opts.content
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
  opts: { sessionToken: string; customerId?: string | null; userContent: string; assistantContent: string }
): Promise<void> {
  if (!opts.sessionToken) return;
  try {
    await insertMessage(db, { sessionToken: opts.sessionToken, customerId: opts.customerId, role: 'user', content: opts.userContent });
    await insertMessage(db, { sessionToken: opts.sessionToken, customerId: opts.customerId, role: 'assistant', content: opts.assistantContent });
    await db
      .prepare(
        `DELETE FROM agent_messages
          WHERE session_token = ?
            AND id NOT IN (
              SELECT id FROM agent_messages WHERE session_token = ? ORDER BY created_at DESC LIMIT ?
            )`
      )
      .bind(opts.sessionToken, opts.sessionToken, MAX_STORED_PER_SESSION)
      .run();
  } catch (err) {
    console.error('[agent] failed to persist conversation turn, continuing:', err);
  }
}

/**
 * Restores the last turns of a conversation, scoped to this browser's session_token. Not merged
 * across a signed-in customer's other devices/sessions — two devices chatting the same day would
 * otherwise interleave into one confusing transcript. customer_id is still recorded on write for
 * future use (support lookup, cross-device recall as a deliberate feature); it is not read here.
 * Returns oldest-first, ready to feed straight into the chat UI.
 */
export async function loadAgentHistory(
  db: Env['DB'],
  opts: { sessionToken: string }
): Promise<StoredAgentMessage[]> {
  if (!opts.sessionToken) return [];
  try {
    const { results } = await db
      .prepare('SELECT role, content FROM agent_messages WHERE session_token = ? ORDER BY created_at DESC LIMIT ?')
      .bind(opts.sessionToken, HISTORY_LIMIT)
      .all<StoredAgentMessage>();
    return (results || []).reverse();
  } catch (err) {
    console.error('[agent] failed to load history, continuing without it:', err);
    return [];
  }
}
