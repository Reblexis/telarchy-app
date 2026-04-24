-- 0019: Agent telemetry tables. The out-of-process telarchy-agents service
-- pushes per-cycle heartbeats (last/next tick, last cycle outcome) and
-- per-session decision traces (LLM strategies) so the admin UI can show what
-- the bots are thinking without tailing logs on the host.

CREATE TABLE IF NOT EXISTS "agent_traces" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "strategy" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp NOT NULL,
  "model" text,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "cache_read" integer NOT NULL DEFAULT 0,
  "cache_write" integer NOT NULL DEFAULT 0,
  "candidates" integer NOT NULL DEFAULT 0,
  "traded" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0,
  "errors" integer NOT NULL DEFAULT 0,
  "cost_usd" double precision NOT NULL DEFAULT 0,
  "entries" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "agent_traces_workspace_started_idx"
  ON "agent_traces" ("workspace_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_traces_agent_started_idx"
  ON "agent_traces" ("agent_id", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "agent_heartbeats" (
  "agent_id" text PRIMARY KEY,
  "status" text NOT NULL DEFAULT 'idle',
  "workspace_id" text,
  "strategy" text,
  "last_cycle_started_at" timestamp,
  "last_cycle_ended_at" timestamp,
  "next_cycle_at" timestamp,
  "poll_interval_seconds" integer NOT NULL DEFAULT 0,
  "workspaces_visited" integer NOT NULL DEFAULT 0,
  "last_traded" integer NOT NULL DEFAULT 0,
  "last_skipped" integer NOT NULL DEFAULT 0,
  "last_errors" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "balance" double precision,
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);
