-- Migration 0029 — Sourcing scanner & harvest-season calendar.
--
-- Two related concepts that previously lived only in the roaster's head:
--
--   1. sourcing_lots  — one row per green-bean contract / purchase / shipment.
--      Tracks the whole pipeline: Probed → In Transit → Cleared → In Silo → Roasted.
--      Optional product_id is filled in once the lot is roasted into a SKU, which
--      is what links the procurement calendar to the catalog & inventory.
--
--   2. sourcing_seasons — per-origin (country + region) harvest window. Drives the
--      calendar overlay so the operator can see at a glance which origins are
--      in-pick, in-transit, or about to land in any given month.
--
-- The harvest calendar is read-only seed-ish data (admin can edit it but it isn't
-- a transactional state machine), so the table is small and lacks status columns
-- on purpose — the value is the date range, not a workflow.

CREATE TABLE IF NOT EXISTS sourcing_lots (
    id TEXT PRIMARY KEY,
    lot_code TEXT NOT NULL,                       -- Internal / supplier lot reference, e.g. "ETH-YIRG-2026-A1"
    supplier_name TEXT NOT NULL,                  -- Importer / exporter / estate name
    origin_country TEXT NOT NULL,                 -- Free-text country, matches products.origin_country
    region TEXT,                                  -- Sub-region / washing station / estate
    process_method TEXT,                          -- WASHED / NATURAL / HONEY / ANAEROBIC / WET_HULLED
    variety TEXT,                                 -- Heirloom, Bourbon, Caturra, etc.
    altitude_meters INTEGER,
    green_kg_ordered REAL NOT NULL DEFAULT 0,    -- Quantity committed
    green_kg_received REAL NOT NULL DEFAULT 0,    -- Quantity actually landed
    contract_price_cents_per_kg INTEGER,          -- Optional landed cost in USD cents
    currency TEXT NOT NULL DEFAULT 'usd',
    contract_date DATE,                           -- When the contract was signed
    expected_eta DATE,                            -- When the importer said it would land
    landed_at DATE,                               -- When it actually cleared customs
    status TEXT NOT NULL DEFAULT 'PROBED',        -- PROBED, IN_TRANSIT, CLEARED, IN_SILO, ROASTED, CANCELLED
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL, -- Filled in once linked to a SKU
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sourcing_lots_status ON sourcing_lots(status);
CREATE INDEX IF NOT EXISTS idx_sourcing_lots_origin ON sourcing_lots(origin_country);
CREATE INDEX IF NOT EXISTS idx_sourcing_lots_eta ON sourcing_lots(expected_eta);
CREATE INDEX IF NOT EXISTS idx_sourcing_lots_landed ON sourcing_lots(landed_at);

CREATE TABLE IF NOT EXISTS sourcing_seasons (
    id TEXT PRIMARY KEY,
    origin_country TEXT NOT NULL,                 -- Same value space as products.origin_country
    region TEXT,                                  -- Sub-region; null = country-wide default
    season_label TEXT NOT NULL,                   -- e.g. "Main crop 2026"
    harvest_start DATE NOT NULL,                  -- First day of picking
    harvest_end DATE NOT NULL,                    -- Last day of picking
    ship_start DATE,                              -- When parchment/natural starts moving
    ship_end DATE,                                -- Last day of shipment from origin
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- One row per (country, region, season) so re-running the migration or the
    -- upsert from the admin UI can't silently double-book a window.
    UNIQUE (origin_country, region, season_label)
);

CREATE INDEX IF NOT EXISTS idx_sourcing_seasons_origin ON sourcing_seasons(origin_country);
CREATE INDEX IF NOT EXISTS idx_sourcing_seasons_window ON sourcing_seasons(harvest_start, harvest_end);
