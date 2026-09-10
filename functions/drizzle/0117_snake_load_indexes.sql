-- Reads are bounded in the size of a workspace (docs/infra/deploy.md).
-- Additive indexes only; record: telarchy umbrella notes/snake-load-audit-2026-09-10.md.

-- markets: lookups by proposal in any state (item 4), the open set and the open baseline set (item 5)
CREATE INDEX IF NOT EXISTS "markets_ws_proposal_idx" ON "markets" ("workspace_id", "proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_ws_open_idx" ON "markets" ("workspace_id", "metric_id", "target_date") WHERE "resolved" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_ws_open_baseline_idx" ON "markets" ("workspace_id", "metric_id", "target_date") WHERE "resolved" = false AND "proposal_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_resolved_at_idx" ON "markets" ("resolved_at") WHERE "resolved" = true;--> statement-breakpoint

-- proposals: status sweeps, deadline sweeps, newest-first lists, stats (items 2, 3, 10, 11)
CREATE INDEX IF NOT EXISTS "proposals_ws_status_created_idx" ON "proposals" ("workspace_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_ws_created_idx" ON "proposals" ("workspace_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_ws_pending_decide_idx" ON "proposals" ("workspace_id", "decide_by") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_status_resolved_idx" ON "proposals" ("status", "resolved_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_proposed_by_created_idx" ON "proposals" ("proposed_by", "created_at");--> statement-breakpoint

-- liquidity_events: funding lookups by market alone (item 9)
CREATE INDEX IF NOT EXISTS "liquidity_events_market_idx" ON "liquidity_events" ("market_id");--> statement-breakpoint

-- trades: count-by-market (item 13)
CREATE INDEX IF NOT EXISTS "trades_market_idx" ON "trades" ("market_id");
