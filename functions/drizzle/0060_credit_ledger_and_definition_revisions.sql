-- Two more append-only records, so a workspace's money state is reconstructible.
--
-- `credit_ledger`: every change to agents.balance, from any path, with the
-- reason it happened. Before this, trades and liquidity_events were the only
-- protected records, but they are two of about a dozen ways credits move
-- (payouts, void refunds, proposal stakes and rewards, spam penalties,
-- contract payments, signup grants, admin adjustments, limit-order holds).
-- Those all wrote the balance column directly and left nothing behind, so a
-- wrong balance could not be explained and a lost one could not be rebuilt.
--
-- `metric_definition_revisions`: what a market was settling on, and when it
-- changed. Editing a metric's description used to void every open market on
-- it; from 2026-08-18 the edit applies in place and this table is what keeps
-- the change honest (governing doc: docs/market-integrity.md).

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "agent_id" text NOT NULL,
  -- Nanocredits, same unit as agents.balance. Signed: negative is a debit.
  "delta_units" bigint NOT NULL,
  -- The balance this row produced. Stored rather than derived so a divergence
  -- is visible at the row where it started, not only in the total.
  "balance_after_units" bigint NOT NULL,
  "reason" text NOT NULL,
  -- What caused it: 'market' | 'proposal' | 'transfer' | 'season' | null.
  "ref_type" text,
  "ref_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "credit_ledger_pk" PRIMARY KEY ("id", "workspace_id")
);

CREATE INDEX IF NOT EXISTS "credit_ledger_agent_idx"
  ON "credit_ledger" ("agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "credit_ledger_ws_idx"
  ON "credit_ledger" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "metric_definition_revisions" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "metric_id" text NOT NULL,
  -- 'name' | 'description' | 'formula' | 'marketRangeMax'
  "field" text NOT NULL,
  "old_value" text,
  "new_value" text,
  -- Agent id or auth user id of whoever saved it, when known.
  "changed_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "metric_definition_revisions_pk" PRIMARY KEY ("id", "workspace_id")
);

CREATE INDEX IF NOT EXISTS "metric_definition_revisions_metric_idx"
  ON "metric_definition_revisions" ("metric_id", "created_at");

-- Same append-only guarantee as trades and liquidity_events (migration 0055):
-- INSERT freely, UPDATE and DELETE refused unless a transaction deliberately
-- sets telarchy.ledger_admin (workspace or participant deletion).
DROP TRIGGER IF EXISTS credit_ledger_append_only ON "credit_ledger";
CREATE TRIGGER credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();

DROP TRIGGER IF EXISTS metric_definition_revisions_append_only ON "metric_definition_revisions";
CREATE TRIGGER metric_definition_revisions_append_only
  BEFORE UPDATE OR DELETE ON "metric_definition_revisions"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();

-- Backfill, so the reconciliation invariant is true from the first deploy
-- rather than only on a fresh database.
--
-- Every participant that exists right now holds a balance that no ledger row
-- explains: it was accumulated by twenty-five call sites that wrote the column
-- directly. Without this, sum(credit_ledger) = agents.balance passes in tests
-- (where every account is created after the migration) and fails in production
-- for every account, which is the worst possible place for an invariant to be
-- false. One opening row per participant states the balance as of this
-- migration and asks no questions about how it got there.
INSERT INTO "credit_ledger" ("id", "workspace_id", "agent_id", "delta_units", "balance_after_units", "reason", "ref_type", "ref_id", "created_at")
SELECT
  gen_random_uuid()::text,
  'platform',
  a."id",
  a."balance",
  a."balance",
  'opening_balance',
  NULL,
  '0060-backfill',
  now()
FROM "agents" a
WHERE a."balance" <> 0;
