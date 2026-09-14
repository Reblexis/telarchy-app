-- Reads keyed by the participant, bounded market listings and the season's
-- traded-books read (docs/infra/deploy.md, "Reads are bounded in the size of a
-- workspace"). Additive.
CREATE INDEX IF NOT EXISTS "trades_agent_created_idx" ON "trades" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_agent_ws_idx" ON "positions" USING btree ("agent_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_ws_created_idx" ON "markets" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_ws_resolved_at_idx" ON "markets" USING btree ("workspace_id","resolved_at") WHERE "markets"."resolved" = true;--> statement-breakpoint
-- Books traded before traded_volume existed (migration 0011) still carry 0,
-- and the season's settled read now keys on it: give them their volume first.
UPDATE "markets" AS m SET "traded_volume" = s.v FROM (SELECT "market_id", "workspace_id", sum(abs("cost")) AS v FROM "trades" WHERE "kind" = 'trade' GROUP BY "market_id", "workspace_id") AS s WHERE m."id" = s."market_id" AND m."workspace_id" = s."workspace_id" AND m."traded_volume" = 0 AND s.v > 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_resolved_traded_idx" ON "markets" USING btree ("resolved_at") WHERE "markets"."resolved" = true and "markets"."traded_volume" > 0;
