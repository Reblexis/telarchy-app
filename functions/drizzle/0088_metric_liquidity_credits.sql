-- The credits a new market on this metric opens with (docs/metrics-page.md).
-- NULL means "the workspace default" (workspaces.new_market_liquidity_credits),
-- which is what every metric carried before this column existed. Denominated in
-- credits, deliberately not a weight: the owner reads pools in credits, so the
-- control and its effect share a unit.
ALTER TABLE "metrics" ADD COLUMN IF NOT EXISTS "liquidity_credits" double precision;
