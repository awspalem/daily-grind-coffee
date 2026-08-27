-- 0021: store Workers AI embeddings on the products table.
--
-- Before this migration, apps/api/src/routes/agent.ts (semantic_coffee_search)
-- embedded the query and re-embedded every product on every tool call. With
-- ~10 products that's 1 query embedding + 10 product embeddings fired in
-- parallel, all serialized by Workers AI's per-isolate concurrency limit
-- (~6-8 concurrent calls). The tool turn cost 2-3 s and burned through
-- Workers AI neurons — both problems vanish once products are embedded
-- once at write time and only the query is embedded per call.
--
-- embedding_json holds the dense vector as JSON text so the migration is
-- portable (D1 has no native vector type). Cosine similarity is computed
-- in-process from the parsed arrays.

ALTER TABLE products ADD COLUMN embedding_json TEXT;
ALTER TABLE products ADD COLUMN embedding_model TEXT;
ALTER TABLE products ADD COLUMN embedding_updated_at DATETIME;

-- The semantic-search query is `WHERE embedding_json IS NOT NULL` filtered
-- down to the active set. A composite (is_active, embedding_updated_at DESC)
-- index lets the backfill query find the next row to embed quickly.
CREATE INDEX IF NOT EXISTS idx_products_embedding_pending
    ON products(embedding_updated_at)
    WHERE embedding_json IS NULL;
