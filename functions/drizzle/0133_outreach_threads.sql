-- Threads and the overnight agent on the outreach workbench
-- (docs/outreach-workbench.md, "The prospect", "Threads", "The overnight agent").
--
-- Additive. A prospect gains why it is here and what its first message tests
-- (`variant`, `reasoning`) and who put it there (`source`, owner or agent).
-- `outreach_messages` holds everything after the first message: what they
-- wrote back (`in`) and the follow-ups (`out`). A reply is recorded once
-- however often a thread is read, which the unique index on the reply's text
-- enforces even when two readers arrive together. The agent learnings are a
-- second `outreach_lessons` row, id 'agent', so they need no table.
ALTER TABLE "outreach_prospects" ADD COLUMN IF NOT EXISTS "variant" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN IF NOT EXISTS "reasoning" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "prospect_id" text NOT NULL REFERENCES "outreach_prospects"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "text" text NOT NULL,
  "status" text NOT NULL,
  "variant" text,
  "reasoning" text,
  "at" timestamp,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_messages_prospect_idx" ON "outreach_messages" ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_messages_reply_once_idx" ON "outreach_messages" ("prospect_id", md5("text")) WHERE "direction" = 'in';
