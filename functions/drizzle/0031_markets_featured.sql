-- 0031: Featured-markets flag.
--
-- A boolean column on markets used by the public /benchmark surface and the
-- companion /api/marketplace/featured endpoint to curate which markets count
-- for the current benchmark pilot. Default false so existing markets are
-- unaffected; operators flip the flag on the pilot pool via /api/admin.

ALTER TABLE "markets"
  ADD COLUMN IF NOT EXISTS "featured" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "markets_featured_idx" ON "markets" ("featured") WHERE "featured" = true;
