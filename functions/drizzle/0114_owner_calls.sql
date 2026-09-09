-- The owner's own call, beside the market's (docs/owner-on-the-floor.md, "The
-- owner's own call"). Append-only: a second call on the same metric and date
-- is a second row, never an edit, because a forecast that can be rewritten
-- after the fact is not one.
CREATE TABLE IF NOT EXISTS "owner_calls" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "metric_id" text NOT NULL,
  "target_date" text NOT NULL,
  "value" double precision NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "owner_calls_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
CREATE INDEX IF NOT EXISTS "owner_calls_ws_metric_date_idx" ON "owner_calls" ("workspace_id","metric_id","target_date","created_at");
