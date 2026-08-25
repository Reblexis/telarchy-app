ALTER TABLE "permission_groups" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "permission_groups" SET "capabilities" = '["read"]'::jsonb WHERE "type" = 'public';
--> statement-breakpoint
UPDATE "permission_groups" SET "capabilities" = '["read","trade","manage"]'::jsonb WHERE "type" = 'admin';
--> statement-breakpoint
UPDATE "permission_groups" SET "capabilities" = '["read","trade"]'::jsonb WHERE "type" = 'trader';
