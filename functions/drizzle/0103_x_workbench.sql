-- The X workbench (docs/x-workbench.md).
--
-- Two tables, both additive. `x_replies` is the log of what the owner sent
-- and what it earned; `x_voice_profile` holds the writing samples and the
-- facts a draft is allowed to state.
--
-- The voice profile is a database row and not a file in this repository
-- because it is his personal writing and the repo is prepared for a public
-- release. One row, id 'default'.
--
-- `reply_id` is nullable: the text is recorded when he sends it, the id is
-- pasted afterwards if at all, and a row without one is still a record of
-- what he wrote. The unique index therefore has to tolerate many nulls,
-- which Postgres does by default.
CREATE TABLE IF NOT EXISTS "x_replies" (
  "id" text PRIMARY KEY NOT NULL,
  "source_post_id" text NOT NULL,
  "source_author" text,
  "source_text" text,
  "source_followers" integer,
  "text" text NOT NULL,
  "reply_id" text,
  "likes" integer,
  "replies" integer,
  "metrics_at" timestamp,
  "has_number" boolean DEFAULT false NOT NULL,
  "disagrees" boolean DEFAULT false NOT NULL,
  "length" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_replies_created_idx" ON "x_replies" ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "x_replies_reply_id_idx" ON "x_replies" ("reply_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x_voice_profile" (
  "id" text PRIMARY KEY NOT NULL,
  "profile" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
