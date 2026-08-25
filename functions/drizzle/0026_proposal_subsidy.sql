-- 0026: Per-proposal forecast subsidy.
--
-- A proposal's conditional markets only produce useful signal when their
-- LMSR pool is funded. Until now the conditional pool was a synthesized
-- copy of the baseline market's `liquidity` parameter with no
-- liquidityEvents row backing it; if the baseline was unfunded, every
-- conditional market shipped at zero liquidity and traders saw no point
-- placing orders. The decision-quality of the whole proposal review
-- collapsed silently.
--
-- This migration adds the funding model:
--
-- - workspaces.default_proposal_liquidity: per-market credit default that
--   prefills the proposal-create modal. Owners who proposes a lot can
--   set this once and stop thinking about it.
-- - proposals.liquidity_subsidy: the actual per-market amount chosen at
--   creation. Debited from the proposer's balance and recorded as a real
--   liquidityEvents row on each conditional market, so LP refunds at
--   void/resolve flow through the same path as manual injections.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_proposal_liquidity" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "liquidity_subsidy" double precision NOT NULL DEFAULT 0;
