-- A retried trade must not become a second trade.
--
-- The participants trading here are bots, so a request that times out after
-- the server has committed is retried automatically and unattended. Retrying
-- buys again, on a curve the first attempt already moved, so the participant
-- pays twice for one decision; not retrying leaves it unsure whether it holds
-- a position. Neither surfaces as an error, which is why the cost has been
-- invisible rather than absent.
--
-- One row per (participant, workspace, Idempotency-Key) that actually placed
-- a trade. The key is the CALLER's, so it is scoped by participant: "1" is a
-- key someone will choose, and two participants choosing it must not collide.
-- `request_hash` is the canonicalised body, so the same key sent with a
-- different body is refused (409) rather than served the earlier result, which
-- would tell a caller a trade it never asked for had been placed. Only a
-- committed trade writes a row, so a call that failed leaves the key free for
-- a genuine retry.
CREATE TABLE IF NOT EXISTS "trade_idempotency" (
  "agent_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "key" text NOT NULL,
  "request_hash" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "trade_idempotency_agent_id_workspace_id_key_pk"
    PRIMARY KEY ("agent_id", "workspace_id", "key")
);

-- These rows are only useful while a client might still be retrying, so the
-- pruning job that eventually removes them reads this.
CREATE INDEX IF NOT EXISTS "trade_idempotency_created_idx"
  ON "trade_idempotency" ("created_at");
