-- 0017: Unify vaults + connectors into a single `sources` table, and merge
-- `vault_permissions` + `connector_permissions` into a single `source_permissions`
-- map on `permission_groups`. Sources are workspace-scoped information stores,
-- with `type` discriminating between static text ('text') and live external
-- bridges ('github'). Adding new source types later is a type-discriminator change,
-- not a new top-level concept.

CREATE TABLE IF NOT EXISTS "sources" (
  "id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "type" text NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "config" jsonb NOT NULL DEFAULT '{}',
  "credentials" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "sources_pkey" PRIMARY KEY ("id", "workspace_id")
);

-- Migrate existing vaults into sources (type='text').
INSERT INTO "sources" (id, workspace_id, name, description, type, content, config, credentials, created_at, updated_at)
SELECT id, workspace_id, name, description, 'text', content, '{}'::jsonb, '', created_at, updated_at
FROM "vaults"
ON CONFLICT (id, workspace_id) DO NOTHING;

-- Migrate existing connectors into sources (type=provider, typically 'github').
INSERT INTO "sources" (id, workspace_id, name, description, type, content, config, credentials, created_at, updated_at)
SELECT id, workspace_id, name, '', provider, '', provider_config, credentials, created_at, updated_at
FROM "connectors"
ON CONFLICT (id, workspace_id) DO NOTHING;

-- Merge vault_permissions + connector_permissions into source_permissions.
ALTER TABLE "permission_groups" ADD COLUMN IF NOT EXISTS "source_permissions" jsonb NOT NULL DEFAULT '{}';

UPDATE "permission_groups"
SET "source_permissions" = COALESCE("vault_permissions", '{}'::jsonb) || COALESCE("connector_permissions", '{}'::jsonb);

ALTER TABLE "permission_groups" DROP COLUMN IF EXISTS "vault_permissions";
ALTER TABLE "permission_groups" DROP COLUMN IF EXISTS "connector_permissions";

DROP TABLE IF EXISTS "vaults";
DROP TABLE IF EXISTS "connectors";
