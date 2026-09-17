-- A proposer's liquidity chosen per book (docs/guides/get-paid.md, "Posting
-- one"): agentId -> [{ metricId, targetDate, amount }], amount into each
-- branch book of that metric and date. Respawns reseed the same books.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "subsidy_cells" jsonb DEFAULT '{}'::jsonb NOT NULL;
