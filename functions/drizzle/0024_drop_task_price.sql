-- 0024: Drop the task `price` field and the matching `agents.earned_tasks`
-- counter.
--
-- The price field on a proposed task confused users: it is an enforced
-- numeric input even when the proposer has nothing meaningful to put there
-- and forced an admin into a "pay X credits on approve" framing the product
-- does not need. Conditional markets price the proposal against the owner's
-- metrics; the headline forecast is what the approver needs, not a pseudo
-- bounty. Any concrete cost or compensation can live in the description.
--
-- Removing `tasks.price` makes the per-approval payout obsolete, which makes
-- `agents.earned_tasks` an orphan counter; drop it too.

ALTER TABLE "tasks" DROP COLUMN IF EXISTS "price";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "earned_tasks";
