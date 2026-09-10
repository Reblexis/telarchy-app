-- Reference forecasts (docs/metrics.md, "The reference forecaster, and
-- reference forecasts"): a participant's own settle estimate on a market,
-- filed as a number with the instant it was made. Read by the
-- skill-vs-reference metric for the reference participant's rows.
CREATE TABLE IF NOT EXISTS "market_forecasts" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "market_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "value" double precision NOT NULL,
  "stage" text DEFAULT 'spawn' NOT NULL,
  "model" text,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "market_forecasts_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);
CREATE INDEX IF NOT EXISTS "market_forecasts_market_idx" ON "market_forecasts" ("market_id","agent_id");
