-- 0020: Optional unique participant nicknames.
-- Both signup paths (human auth + API agent register) can claim a nickname.
-- Uniqueness is case-insensitive and applies only to non-null values, so the
-- field stays optional. Format is enforced at the application layer.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "nickname" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_nickname_lower_idx"
  ON "agents" (LOWER("nickname")) WHERE "nickname" IS NOT NULL;
