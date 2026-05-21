-- 0033: Dual-branch conditional markets (approved / declined).
--
-- Each proposal now spawns TWO conditional markets per (metric, targetDate):
-- one priced under the assumption the proposal is approved, one under the
-- assumption it is declined. The headline impact number for humans becomes
-- consensus(approved) - consensus(declined), which isolates the causal effect
-- of approving and removes the contamination where the natural-trajectory
-- baseline already prices in expected approval.
--
-- Schema: a new nullable text column `branch` on markets. NULL on non-proposal
-- (natural-trajectory) markets; 'approved' or 'declined' on conditional ones.
-- Existing conditional markets are backfilled to 'approved' so already-in-
-- flight proposals continue to behave like single-branch until they resolve.

ALTER TABLE "markets"
  ADD COLUMN IF NOT EXISTS "branch" text;

UPDATE "markets"
  SET "branch" = 'approved'
  WHERE "proposal_id" IS NOT NULL AND "branch" IS NULL;

ALTER TABLE "markets"
  DROP CONSTRAINT IF EXISTS "markets_branch_check";
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_branch_check" CHECK (
    ("proposal_id" IS NULL AND "branch" IS NULL)
    OR ("proposal_id" IS NOT NULL AND "branch" IN ('approved', 'declined'))
  );

-- Prevent re-spawning the same (proposal, metric, targetDate, branch) market
-- while still open. Partial index, scoped to unresolved conditional rows so
-- the historical record stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS "markets_proposal_branch_open_idx"
  ON "markets" ("workspace_id", "proposal_id", "metric_id", "target_date", "branch")
  WHERE "resolved" = false AND "proposal_id" IS NOT NULL;
