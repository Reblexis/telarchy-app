-- 0010: Remove the legacy global role column from agents.
-- Permissions are now derived entirely from workspace-scoped permission groups.
-- The role column was vestigial and caused cross-workspace privilege confusion.

ALTER TABLE "agents" DROP COLUMN IF EXISTS "role";
