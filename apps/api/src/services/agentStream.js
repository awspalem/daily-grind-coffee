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
export {};
