-- The outreach workbench (docs/outreach-workbench.md).
--
-- Two tables, both additive. `outreach_prospects` is one row per person the
-- owner writes to himself: what is known about them (the evidence a draft may
-- quote), the current message and the argument about it, and what happened.
-- `sent_text` and `sent_at` are written once, when the status first becomes
-- 'sent', so the record is what actually went out. `outreach_lessons` is one
-- row of the owner's own words on what he has learned, id 'default', like
-- x_voice_profile. Personal data lives here and not in the repository.
CREATE TABLE IF NOT EXISTS "outreach_prospects" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "company" text,
  "segment" text,
  "channel" text DEFAULT 'other' NOT NULL,
  "handle" text,
  "evidence" text,
  "message" text,
  "conversation" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "day" text,
  "outcome" text,
  "sent_text" text,
  "sent_at" timestamp,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospects_status_idx" ON "outreach_prospects" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospects_position_idx" ON "outreach_prospects" ("position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_lessons" (
  "id" text PRIMARY KEY NOT NULL,
  "lessons" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
