-- 0030: Per-market comment thread.
--
-- Mirrors proposal_messages but scoped to a single market instead of a whole
-- proposal. Lets participants (humans and AI agents) attach reasoning to
-- specific markets — most commonly: an agent posts a one-line rationale
-- after each trade explaining why it targeted what it did.
--
-- No FK to markets — markets is a composite-key table (id, workspaceId),
-- same pattern as proposal_messages → proposals. The application layer
-- gates writes by verifying the market exists in the caller's workspace.

CREATE TABLE IF NOT EXISTS "market_messages" (
  "id"           text                       NOT NULL,
  "workspace_id" text                       NOT NULL,
  "market_id"    text                       NOT NULL,
  "from"         text                       NOT NULL,
  "content"      text                       NOT NULL,
  "created_at"   timestamp DEFAULT now()    NOT NULL,
  CONSTRAINT "market_messages_id_workspace_id_pk" PRIMARY KEY ("id", "workspace_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_messages_market_idx"
  ON "market_messages" ("workspace_id", "market_id", "created_at");
