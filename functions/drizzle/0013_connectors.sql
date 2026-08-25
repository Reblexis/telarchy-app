-- 0013: Add connectors table and connector_permissions column on permission_groups.
-- Connectors are workspace-scoped live bridges to external systems (e.g. GitHub repos).

CREATE TABLE IF NOT EXISTS "connectors" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "provider_config" jsonb NOT NULL DEFAULT '{}',
  "credentials" text NOT NULL DEFAULT '',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "connectors_pkey" PRIMARY KEY ("id", "workspace_id")
);

ALTER TABLE "permission_groups" ADD COLUMN IF NOT EXISTS "connector_permissions" jsonb NOT NULL DEFAULT '{}';
