-- 0009: Add vaults table and vault_permissions column on permission_groups.
-- Vaults are workspace-scoped free-text information stores with permission-group-based access control.

CREATE TABLE IF NOT EXISTS "vaults" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "content" text NOT NULL DEFAULT '',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vaults_pkey" PRIMARY KEY ("id", "workspace_id")
);

ALTER TABLE "permission_groups" ADD COLUMN IF NOT EXISTS "vault_permissions" jsonb NOT NULL DEFAULT '{}';
