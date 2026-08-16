-- Storefront footer email capture. Not yet wired into any outbound send — this only
-- persists the opt-in; the marketing_automation/communication_channels tables handle
-- actual send tracking once that's built out.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'storefront_footer',
    status TEXT NOT NULL DEFAULT 'SUBSCRIBED', -- SUBSCRIBED, UNSUBSCRIBED
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status);
