-- 0007: Clean up stale data and remove obsolete columns
-- Fixes all consistency issues found by test-db-consistency.ts

-- ─── 1. Drop obsolete columns ──────────────────────────────────────────────

ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "custom_api_url";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "default_half_life";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "utility_formula_auto";
ALTER TABLE "metrics" DROP COLUMN IF EXISTS "weight";

-- ─── 2. Fix logical invariants: voided/resolved markets should not be active ─

UPDATE "markets" SET "active" = false WHERE "voided" = true AND "active" = true;
UPDATE "markets" SET "active" = false WHERE "resolved" = true AND "active" = true;

-- ─── 3. Delete orphaned data (referencing non-existent parent records) ─────
-- Order matters: delete child records before parents to avoid cascading orphans.

-- First, find orphan market IDs (markets whose metrics no longer exist)
-- and delete their dependent positions, trades, and liquidity events.

DELETE FROM "positions" p
WHERE NOT EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = p.market_id AND m.workspace_id = p.workspace_id
) OR EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = p.market_id AND m.workspace_id = p.workspace_id
  AND NOT EXISTS (SELECT 1 FROM "metrics" met WHERE met.id = m.metric_id AND met.workspace_id = m.workspace_id)
);

DELETE FROM "trades" t
WHERE NOT EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = t.market_id AND m.workspace_id = t.workspace_id
) OR EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = t.market_id AND m.workspace_id = t.workspace_id
  AND NOT EXISTS (SELECT 1 FROM "metrics" met WHERE met.id = m.metric_id AND met.workspace_id = m.workspace_id)
);

DELETE FROM "liquidity_events" le
WHERE NOT EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = le.market_id AND m.workspace_id = le.workspace_id
) OR EXISTS (
  SELECT 1 FROM "markets" m WHERE m.id = le.market_id AND m.workspace_id = le.workspace_id
  AND NOT EXISTS (SELECT 1 FROM "metrics" met WHERE met.id = m.metric_id AND met.workspace_id = m.workspace_id)
);

-- Now delete the orphan markets themselves
DELETE FROM "markets" m
WHERE NOT EXISTS (
  SELECT 1 FROM "metrics" met WHERE met.id = m.metric_id AND met.workspace_id = m.workspace_id
);

-- API keys referencing non-existent workspaces
DELETE FROM "agent_api_keys" ak
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" w WHERE w.id = ak.workspace_id
);

-- ─── 4. Delete bogus workspace references ──────────────────────────────────

DELETE FROM "metrics" WHERE workspace_id = 'undefined';
DELETE FROM "events" WHERE workspace_id = 'undefined';

-- ─── 5. Clean up stale system state ────────────────────────────────────────

DELETE FROM "system_config" WHERE key LIKE 'lock:marketRefresh:%';
DELETE FROM "session" WHERE expires_at < NOW();
