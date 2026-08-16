-- Customer account login. customer.ts's existing GET /me trusted a bare X-Customer-Email
-- header with zero proof of ownership — anyone could type any customer's email and see their
-- order history and saved addresses. Replacing that with real passwordless auth: a one-time
-- code emailed to the address, exchanged for a session token.
--
-- customer_sessions already exists (0001_init.sql, present since the very first deploy — unlike
-- `subscriptions`, it was never edited after the fact, so there's no reason to believe it's
-- missing from the live DB the way that table was). Only the login-code table is new.
CREATE TABLE IF NOT EXISTS customer_login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email ON customer_login_codes(email);
