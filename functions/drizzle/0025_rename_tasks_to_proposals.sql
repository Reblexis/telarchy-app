-- 0025: Rename `tasks` to `proposals` (and the related table/column).
--
-- The product calls these "proposals" everywhere now: a proposal is the
-- thing a participant suggests doing, conditional markets price the
-- proposal against the workspace's metrics, and a human approves on the
-- forecast. The legacy "task" name predated that framing and confused new
-- users who expected a Trello-style task list. This migration renames the
-- physical schema; the application code (routes, services, types) is
-- updated in the same change.
--
-- Note: `agents.earned_tasks` was dropped in 0024_drop_task_price.sql, so
-- there is no `earned_proposals` rename; the counter is gone.

ALTER TABLE "tasks" RENAME TO "proposals";
--> statement-breakpoint
ALTER TABLE "task_messages" RENAME TO "proposal_messages";
--> statement-breakpoint
ALTER TABLE "proposal_messages" RENAME COLUMN "task_id" TO "proposal_id";
--> statement-breakpoint
ALTER TABLE "markets" RENAME COLUMN "task_id" TO "proposal_id";
