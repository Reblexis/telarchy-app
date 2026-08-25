-- 0040: Participant-to-participant credit transfers.
--
-- Why: credits previously moved only via trading, deposits, payouts, and
-- admin crediting. POST /api/agents/transfer adds the plain "pay another
-- participant" wallet primitive so external economic systems built on
-- Telarchy (e.g. the agent-economy bank's credit<->compute-credit exchange)
-- can settle between participants without Telarchy hosting banking logic.
-- This table is the visible ledger of those moves; balance mutations happen
-- on agents.balance in nanocredits, amounts here are display credits.

CREATE TABLE IF NOT EXISTS "credit_transfers" (
  "id" text PRIMARY KEY,
  "from_agent_id" text NOT NULL REFERENCES "agents"("id"),
  "to_agent_id" text NOT NULL REFERENCES "agents"("id"),
  "credits" double precision NOT NULL,
  "memo" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transfers_from_idx" ON "credit_transfers" ("from_agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transfers_to_idx" ON "credit_transfers" ("to_agent_id");
