-- 0034: GitHub-style workspace URLs.
-- Add a per-owner-unique slug to workspaces (drives /{ownerHandle}/{slug}) and a
-- workspace_slug_aliases table holding every slug a workspace has ever had so
-- renames can 301-redirect old links and an owner cannot reuse a freed slug.
-- Backfill derives slugs from existing names, deduped per owner.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "slug" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_slug_aliases" (
  "workspace_id" text NOT NULL,
  "owner_key" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Backfill: slugify name (lowercase, non-alphanumeric -> hyphen, trim hyphens),
-- fall back to 'workspace' when empty, and suffix duplicates within an owner.
WITH base AS (
  SELECT
    id,
    created_by,
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
          '(^-+|-+$)', '', 'g'
        ),
        ''
      ),
      'workspace'
    ) AS base_slug
  FROM "workspaces"
  WHERE slug IS NULL
),
numbered AS (
  SELECT
    id,
    base_slug,
    row_number() OVER (PARTITION BY created_by, base_slug ORDER BY id) AS rn
  FROM base
)
UPDATE "workspaces" w
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END
FROM numbered n
WHERE w.id = n.id;
--> statement-breakpoint
-- Seed the alias table from current slugs.
INSERT INTO "workspace_slug_aliases" ("workspace_id", "owner_key", "slug", "created_at")
SELECT id, created_by, slug, now()
FROM "workspaces"
WHERE slug IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_owner_slug_idx"
  ON "workspaces" ("created_by", LOWER("slug")) WHERE "slug" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_slug_aliases_owner_slug_idx"
  ON "workspace_slug_aliases" ("owner_key", LOWER("slug"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_slug_aliases_workspace_idx"
  ON "workspace_slug_aliases" ("workspace_id");
