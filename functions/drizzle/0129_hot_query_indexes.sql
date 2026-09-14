-- Reads are bounded in the size of a workspace (docs/infra/deploy.md): the hot
-- statements pg_stat_statements named on production on 2026-09-13
-- (telarchy umbrella notes/gcp-cost-2026-09-13.md). Additive indexes only.
-- A plain CREATE INDEX holds a write lock on its table while it builds; these
-- tables hold 13k to 37k rows, so each build takes well under a second.

-- limit_orders: the actions log's order branches read one floor newest first,
-- by placement and by the last status change.
CREATE INDEX IF NOT EXISTS "limit_orders_ws_created_idx" ON "limit_orders" ("workspace_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "limit_orders_ws_updated_idx" ON "limit_orders" ("workspace_id", "updated_at");--> statement-breakpoint

-- liquidity_events: the actions log's liquidity branch, one floor newest first.
CREATE INDEX IF NOT EXISTS "liquidity_events_ws_created_idx" ON "liquidity_events" ("workspace_id", "created_at");--> statement-breakpoint

-- trades: the bell's "books I traded", answered from the index alone.
CREATE INDEX IF NOT EXISTS "trades_agent_market_idx" ON "trades" ("agent_id", "market_id");
