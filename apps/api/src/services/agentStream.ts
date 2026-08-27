/**
 * Wire format for the streaming Maya endpoints (`/api/agent/chat/stream` and
 * `/api/admin/agent/chat/stream`). Both routes publish the same four event
 * names so the storefront and admin parsers — and any future client — can
 * share one parser.
 *
 * Event names are the SSE `event:` field; the data is a JSON string with the
 * shape below. The actual SSE framing (`event: ...\ndata: ...\n\n`) is
 * written by `hono/streaming`, which this file does not duplicate.
 *
 * Order of events in one turn:
 *   1. zero or more `status` events (one per tool call in flight)
 *   2. zero or more `delta` events (token chunks of the assistant reply)
 *   3. exactly one `done` event (carries the final reply + proposed actions)
 *
 * `error` is reserved for unrecoverable streaming failures; the reply it
 * accompanies is a bare string, NOT JSON.
 */

export type AgentSseEventName = 'status' | 'delta' | 'done' | 'error';

export interface AgentSseStatusEvent {
  /** Short user-facing label shown while a tool call is in flight. */
  label: string;
}

export interface AgentSseDeltaEvent {
  /** One text chunk of the assistant reply. Concatenated in arrival order. */
  text: string;
}

export interface AgentSseDoneEvent {
  /** The complete assistant reply. Equal to concatenating every delta's `text`. */
  reply: string;
  /** Human-in-the-loop actions Maya wants the user to confirm before they fire. */
  proposed_actions: AgentProposedAction[];
}

export type AgentSseErrorEvent = string;

export interface AgentProposedAction {
  /** Customer-side: confirmation token, scoped to the cart/session. */
  confirmation_token?: string;
  /** Admin-side: proposal token, looked up in `admin_action_proposals` on approval. */
  proposal_token?: string;
  tool_name?: string;
  action_type?: string;
  arguments?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  summary: string;
  /** Customer-side: ISO timestamp; the action auto-expires at this time. */
  expires_at?: number;
}
