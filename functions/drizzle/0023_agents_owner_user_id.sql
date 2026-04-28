-- 0023: Track ownership of bot agents distinctly from "this agent IS this user".
--
-- Today `agents.auth_user_id` is unique (one primary participant per BetterAuth
-- user) and means "this human IS this participant". When a human registers a
-- bot via POST /api/agents we want to record ownership so it shows up under
-- their account, but the bot is its own independent participant — not the
-- human. We add `owner_user_id` for that. Nullable; no uniqueness; one human
-- can own many bot agents. Cascade `set null` so bots survive their owner's
-- account deletion as opaque participants (matching how `auth_user_id` is
-- detached on GDPR delete in routes/userauth.ts).

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_user_id_idx" ON "agents" ("owner_user_id");
