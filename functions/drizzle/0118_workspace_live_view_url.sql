-- The owner's live view on the public floor (docs/ui-conventions.md, "The
-- live view"; owner ask 2026-09-10). Nullable: null means the floor renders
-- no box, which is every existing workspace.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "live_view_url" text;
