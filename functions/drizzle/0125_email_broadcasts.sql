-- Announcements by email (docs/announcements-by-email.md; owner ask
-- 2026-09-12). Three tables: who has asked us to stop, what was sent, and
-- what happened to each address.
--
-- The suppression list is keyed on the ADDRESS, not on a participant: a
-- season entrant may have registered through the API and hold no account, and
-- the person who wants the mail stopped is whoever reads that mailbox.
CREATE TABLE IF NOT EXISTS "email_opt_outs" (
  "email" text PRIMARY KEY,
  "at" timestamp NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'link'
);

CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id" text PRIMARY KEY,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "audience" text NOT NULL,
  "season_id" text,
  "reply_to" text,
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- One row per address per broadcast, always: 'sent', 'failed' (with the
-- provider's error) or 'suppressed'. The primary key is what makes a retry
-- finish the job instead of writing to everyone twice.
CREATE TABLE IF NOT EXISTS "broadcast_sends" (
  "broadcast_id" text NOT NULL,
  "email" text NOT NULL,
  "agent_id" text,
  "status" text NOT NULL,
  "error" text,
  "at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("broadcast_id", "email")
);
