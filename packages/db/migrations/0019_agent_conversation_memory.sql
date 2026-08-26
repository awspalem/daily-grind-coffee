-- 0019: persist the barista chat so a page refresh, or a second device, doesn't erase Maya's
-- memory of the conversation.
--
-- Today the entire conversation lives in a 12-message array in the browser tab (main.ts) and is
-- gone the moment the page reloads. Keyed by the anonymous session_token that already anchors
-- carts (0001_init.sql, carts.session_token) since most visitors talk to Maya before ever
-- signing in. customer_id is attached too, best-effort, so a customer who is signed in keeps
-- the same conversation if they come back on another device under a different session_token.
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_token, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_customer ON agent_messages(customer_id, created_at);
