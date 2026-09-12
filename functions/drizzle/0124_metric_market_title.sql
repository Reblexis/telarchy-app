-- The question a visitor reads over this metric's book, in the owner's own
-- words (docs/ui-conventions.md, "The question line"; owner ask 2026-09-12).
-- Nullable: null means the floor composes the question from the workspace
-- name, the metric and the date, which is what every existing metric does.
-- It lives on the metric, not on the market row, because a market is created
-- fresh for every new horizon cell and the owner's words must outlive that.
ALTER TABLE "metrics" ADD COLUMN IF NOT EXISTS "market_title" text;
