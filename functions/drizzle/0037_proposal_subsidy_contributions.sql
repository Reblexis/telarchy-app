-- 0037: Durable proposal subsidy contributions.
--
-- subsidy_contributions maps agentId -> credits per branch market. The
-- proposer's creation-time subsidy and any post-hoc admin top-ups (bulk
-- liquidity injection with proposalId) both land here, and re-spawned
-- conditional markets (target-date rollovers) are re-seeded from this map,
-- debiting each contributor. Previously top-ups lived only in the market
-- rows, so they were refunded and lost on the next rollover, and the
-- proposal's liquidity_subsidy field (display + reseed source) never
-- reflected them. liquidity_subsidy now tracks the running total (sum of
-- the map's values).
--
-- Backfill: proposals with a creation-time subsidy get a single-entry map
-- attributing it to the proposer, which is exactly what the old reseed
-- logic did implicitly.

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "subsidy_contributions" jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE "proposals"
SET "subsidy_contributions" = jsonb_build_object("proposed_by", "liquidity_subsidy")
WHERE "liquidity_subsidy" > 0 AND "subsidy_contributions" = '{}'::jsonb;
