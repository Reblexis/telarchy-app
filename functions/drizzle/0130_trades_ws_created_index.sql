-- The floor payload's week counts (trades this week, bot traders) and the
-- platform's per-workspace week reads filter trades on (workspace_id,
-- created_at). Without this they walked the whole trades table, which a floor
-- deciding a proposal a second grows by thousands of rows a day (telarchy
-- umbrella, notes/chess-play-now-load-plan-2026-09-14.md).
CREATE INDEX IF NOT EXISTS "trades_ws_created_idx" ON "trades" USING btree ("workspace_id","created_at");
