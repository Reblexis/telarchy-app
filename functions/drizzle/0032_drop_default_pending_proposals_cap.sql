-- 0032: Drop the default per-participant pending-proposals cap.
--
-- The cap mechanism stays (workspaces can still set a positive integer via
-- PUT /api/workspaces/:id/settings), but the default flips from 3 to 0
-- (disabled). Existing rows that still hold the old default of 3 are reset
-- to 0 so the limit goes away everywhere it was never explicitly chosen.
-- Workspaces that already set a custom positive value keep it.

ALTER TABLE "workspaces"
  ALTER COLUMN "max_pending_proposals" SET DEFAULT 0;
--> statement-breakpoint
UPDATE "workspaces" SET "max_pending_proposals" = 0 WHERE "max_pending_proposals" = 3;
