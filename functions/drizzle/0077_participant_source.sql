-- Attribution for the open-source release (telarchy/notes/open-source-decision-2026-08-24.md):
-- the release is judged on participants who arrived through the public repo, so
-- a signup or a self-registered agent records where it came from. Nullable, no
-- default: rows from before the column, and arrivals with no tag, stay null.
-- Same pattern as waitlist.source.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source text;
