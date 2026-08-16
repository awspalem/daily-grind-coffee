-- Roast batch logging (green-in vs roasted-out, yield loss %) — previously computed by the
-- POST /api/admin/roast-batch endpoint but never persisted anywhere; the admin UI just appended
-- a row to a local table that vanished on refresh.
CREATE TABLE IF NOT EXISTS roast_batches (
    id TEXT PRIMARY KEY,
    lot_name TEXT NOT NULL,
    green_kg_in REAL NOT NULL,
    roasted_kg_out REAL NOT NULL,
    roast_loss_percent REAL NOT NULL,
    roaster_profile TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roast_batches_created ON roast_batches(created_at DESC);
