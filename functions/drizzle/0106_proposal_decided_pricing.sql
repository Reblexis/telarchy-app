-- The pair prices at the moment a proposal was decided, so the contractor
-- rail scores an approved job on what the decision was priced on and never
-- on what its books did afterwards (docs/ui-conventions.md, "Top
-- contractors"; owner ruling 2026-09-04). Additive: null until the
-- one-off backfill (scripts/backfill-decided-pricing.mjs) and for every
-- pending proposal.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "decided_pricing" jsonb;
