-- Search prompts for X (telarchy-app docs/x-workbench.md, "Finding posts").
--
-- X search needs a paid credential the owner has not bought, so he runs the
-- query himself and pastes back the ids. Remembering the query is what turns
-- that manual step into a loop that improves: `harvested` counts the posts a
-- query yielded, and `x_replies.search_id` says how many were worth answering
-- and what those answers earned. Both additive.
CREATE TABLE IF NOT EXISTS "x_searches" (
  "id" text PRIMARY KEY NOT NULL,
  "query" text NOT NULL,
  "rationale" text,
  "harvested" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_searches_created_idx" ON "x_searches" ("created_at");
--> statement-breakpoint
ALTER TABLE "x_replies" ADD COLUMN IF NOT EXISTS "search_id" text;
