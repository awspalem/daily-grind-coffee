-- 0020: extend agent_messages to remember admin chats, and introduce
-- admin_action_proposals for human-in-the-loop confirmations.
--
-- The storefront Maya (agent_messages.session_token scoped) and the new
-- admin Maya share the agent_messages table so the memory service is one
-- file. We add actor_type ('customer' | 'admin') and actor_id (the admin
-- user id from zeroTrustAdminGuard, or null for customer rows) and filter
-- loadAgentHistory by both, so the two audiences never interleave.
--
-- admin_action_proposals is the human-approval queue: Maya proposes an
-- action (refund, mark shipped, etc.), the SPA renders a card with
-- [Approve] [Reject], and the confirm endpoint flips the row to APPROVED
-- or REJECTED and runs the action. Tokens expire in 15 minutes — same
-- window the customer-side propose_add_to_cart uses.

ALTER TABLE agent_messages ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE agent_messages ADD COLUMN actor_id TEXT;

-- Composite index lets the memory loader fetch the last N turns for a
-- given admin user in one seek instead of a session_token + created_at
-- sort. Existing customer rows keep working (actor_type='customer' default).
CREATE INDEX IF NOT EXISTS idx_agent_messages_actor
    ON agent_messages(actor_type, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_action_proposals (
  id TEXT PRIMARY KEY,
  proposal_token TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolution_note TEXT
);

-- The admin drawer does a PENDING-only lookup when rendering open cards
-- and a status scan when showing the audit history.
CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_status
    ON admin_action_proposals(status, created_at DESC);
