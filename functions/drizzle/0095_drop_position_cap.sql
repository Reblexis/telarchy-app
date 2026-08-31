-- The per-market position cap is retired (owner decision 2026-08-31, see
-- notes/position-cap-retired-2026-08-31.md).
--
-- It capped each participant's cumulative buy cost in one market, and it was
-- enforced server-side only: the trading desk offered a size the API then
-- refused with a 400, which a participant reported as the product being
-- broken rather than as a rule. Nothing else read the column, so dropping it
-- is the whole removal; the caps in force were 5,000 on both live floors.
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "max_position_cost_per_market";
