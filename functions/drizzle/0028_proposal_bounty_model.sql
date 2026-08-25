-- 0028: Bounty model for proposals.
--
-- Replaces the proposer-funds-everything model with: workspace owner pays a
-- flat reward on approval, proposer pays a flat penalty on spam-decline, both
-- sums configurable per workspace. Adds a per-participant pending cap so a
-- single agent cannot fill the review queue. Free withdraw and free good-faith
-- decline cover the legitimate paths.
--
-- The existing liquidity_subsidy column stays for now: workspaces and
-- proposers can still seed conditional-market liquidity if they want better
-- price signal. The bounty mechanism is independent of that and works at
-- subsidy = 0.

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "proposal_reward" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "spam_penalty" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "max_pending_proposals" integer NOT NULL DEFAULT 3;
--> statement-breakpoint
ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "reward_paid" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "penalty_charged" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "resolved_by" text;
