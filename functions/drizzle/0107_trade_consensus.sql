-- The market's call before and after each trade, recorded by the trade
-- transaction (telarchy-app docs/ui-conventions.md, "What the platform
-- records at trade time"). Nullable: rows from before this migration and
-- redemption rows carry nothing, and readers treat null as not recorded.
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "consensus_before" double precision;
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "consensus_after" double precision;
