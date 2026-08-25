-- Drop legacy identity tables and columns (identity merge cleanup)

-- Remove deprecated columns from agents
ALTER TABLE "agents" DROP COLUMN IF EXISTS "owner_uid";

-- Remove deprecated columns from permission_groups
ALTER TABLE "permission_groups" DROP COLUMN IF EXISTS "agent_ids";
ALTER TABLE "permission_groups" DROP COLUMN IF EXISTS "uids";

-- Drop legacy tables
DROP TABLE IF EXISTS "user_workspaces";
DROP TABLE IF EXISTS "app_users";
