-- A proposal has a number: the short per-floor ordinal a person names it
-- by, assigned in posting order and never reused (telarchy-app
-- docs/ui-conventions.md, "A proposal has a number and an address").
-- Backfilled in creation order so every existing proposal has one.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "number" integer;
--> statement-breakpoint
UPDATE "proposals" p SET "number" = n.rn
FROM (
  SELECT id, workspace_id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS rn
  FROM "proposals"
) n
WHERE p.id = n.id AND p.workspace_id = n.workspace_id AND p."number" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposals_workspace_number_idx" ON "proposals" ("workspace_id", "number");
