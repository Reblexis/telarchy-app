-- The decision window in minutes, one day by default, and the one-shot
-- reminder stamp (docs/guides/proposals.md, "The deadline, and the close";
-- owner decision 2026-09-09). decision_days is left in place, unused, so the
-- revision serving through this deploy keeps answering; drop it later.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "decision_minutes" integer NOT NULL DEFAULT 1440;
UPDATE "workspaces" SET "decision_minutes" = GREATEST(1, LEAST(129600, "decision_days" * 1440)) WHERE "decision_days" IS NOT NULL;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "deadline_warned_at" timestamp;
