-- The workspace-wide notification mute (docs/vision.md, "A workspace can
-- mute everything it would send"; owner decision 2026-09-10). Default false,
-- so every existing workspace stays unmuted.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "notifications_muted" boolean NOT NULL DEFAULT false;
