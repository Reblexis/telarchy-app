-- 0071: Indexes for the hot read paths (perf plan 2026-08-20). Regrowth
-- insurance, not present-day tuning: trades hit 348k rows once (lib/board.ts)
-- and pg_stat showed millions of seq scans on these filter shapes. Every
-- composite PK here leads on id, so it serves none of the workspace-scoped
-- reads. All additive; expand/contract-safe under the deploy gate.
CREATE INDEX IF NOT EXISTS "trades_ws_market_created_idx" ON "trades" ("workspace_id","market_id","created_at");
CREATE INDEX IF NOT EXISTS "trades_created_idx" ON "trades" ("created_at");
CREATE INDEX IF NOT EXISTS "liquidity_events_ws_market_created_idx" ON "liquidity_events" ("workspace_id","market_id","created_at");
CREATE INDEX IF NOT EXISTS "positions_workspace_idx" ON "positions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "positions_market_idx" ON "positions" ("market_id");
CREATE INDEX IF NOT EXISTS "markets_workspace_idx" ON "markets" ("workspace_id");
CREATE INDEX IF NOT EXISTS "metric_logs_ws_metric_ts_idx" ON "metric_logs" ("workspace_id","metric_id","timestamp");
CREATE INDEX IF NOT EXISTS "events_ws_ts_idx" ON "events" ("workspace_id","timestamp");
-- Serves the daily retention prune in services/maintenance.ts.
CREATE INDEX IF NOT EXISTS "agent_traces_started_idx" ON "agent_traces" ("started_at");
