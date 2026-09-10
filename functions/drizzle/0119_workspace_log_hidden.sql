-- A floor hidden from the public actions log by default (docs/data-room.md,
-- "An automated floor is hidden by default"; owner decision 2026-09-10 on the
-- snake floor). Default false, so every existing floor stays on the log.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "log_hidden" boolean NOT NULL DEFAULT false;
