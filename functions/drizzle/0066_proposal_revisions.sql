-- A contract's definition edits in place and publishes what changed
-- (docs/market-integrity.md, I1b). Same shape and same reason as
-- metric_definition_revisions: append-only, so a revision cannot be un-made,
-- and rendered beside the contract so a trader holding a position can see
-- whether the words or the price moved after they took it.
CREATE TABLE IF NOT EXISTS "proposal_revisions" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  -- 'title' | 'description' | 'askUsd'
  "field" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "changed_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "proposal_revisions_id_workspace_id_pk" PRIMARY KEY("id","workspace_id")
);

CREATE INDEX IF NOT EXISTS "proposal_revisions_proposal_idx"
  ON "proposal_revisions" ("workspace_id","proposal_id","created_at");
