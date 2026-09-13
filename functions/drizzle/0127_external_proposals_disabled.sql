-- A floor closed to outside proposals (docs/guides/proposals.md, "Closing
-- the floor to outside proposals"). Default false, so every existing
-- workspace keeps accepting proposals from anyone who can trade on it.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "external_proposals_disabled" boolean NOT NULL DEFAULT false;
