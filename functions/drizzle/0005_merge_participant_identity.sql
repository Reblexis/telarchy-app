-- Phase 1: Add platformAdmin and intent columns to agents table
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "platform_admin" boolean NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "intent" text;

-- Migrate data from app_users to agents
UPDATE "agents" a
SET "platform_admin" = au."platform_admin",
    "intent" = au."intent"
FROM "app_users" au
WHERE a."auth_user_id" = au."user_id";

-- Backfill: link agents with ownerUid but no authUserId
UPDATE "agents"
SET "auth_user_id" = "owner_uid"
WHERE "owner_uid" IS NOT NULL
  AND "auth_user_id" IS NULL
  AND "owner_uid" IN (SELECT "id" FROM "user");

-- Backfill workspaces.created_by: ensure it stores the agent ID where possible
UPDATE "workspaces" w
SET "created_by" = a."id"
FROM "agents" a
WHERE a."auth_user_id" = w."created_by"
  AND w."created_by" IS NOT NULL
  AND w."created_by" != a."id";
