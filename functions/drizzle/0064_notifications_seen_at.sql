-- The notifications inbox (owner ask 2026-08-19): one timestamp per
-- participant saying how far they have read.
--
-- Backfilled to now() rather than left null on purpose. The inbox is derived
-- from history that already exists, so a null would mean "everything since
-- the beginning is unread" and every existing account would open the floor to
-- a badge counting months of old comments. Nobody reads a backlog they were
-- never promised; they learn to ignore the badge, which is the one thing a
-- badge must not become.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "notifications_seen_at" timestamp NOT NULL DEFAULT now();
