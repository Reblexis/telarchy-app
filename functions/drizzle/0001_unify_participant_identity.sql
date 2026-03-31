ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "auth_user_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'agents_auth_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_auth_user_id_user_id_fk"
      FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_auth_user_id_idx" ON "agents" ("auth_user_id");
--> statement-breakpoint
ALTER TABLE "permission_groups" ADD COLUMN IF NOT EXISTS "member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
