-- 0022: Multi-key, scoped, labelled API keys.
--
-- agent_api_keys today is just (hash PK, agent_id, workspace_id). Multiple
-- keys per agent already work; this migration adds the metadata needed to
-- manage them from the new /api page:
--
--   key_id        opaque public handle (uuid). Used for revoke/rotate so the
--                 hash never leaves the database.
--   label         optional human label ("local dev", "anchor bot prod").
--   scopes        per-key permission set. Vocabulary lives in
--                 functions/src/lib/scopes.ts. Defaults to '{*}' so existing
--                 keys keep their current full-access behavior; new keys
--                 minted from the UI default to least-privilege at the route
--                 layer.
--   created_at    when the key was minted.
--   last_used_at  bumped (debounced ~60s) by the auth middleware so the UI
--                 can flag keys that haven't been used.

-- Note on column defaults: every new column carries a server-side default
-- so a deploy where the old code temporarily runs against the new schema
-- still succeeds. Old code's inserts to agent_api_keys (which only specify
-- hash/agent_id/workspace_id) get a generated key_id and the wildcard
-- scope list automatically.
ALTER TABLE "agent_api_keys"
  ADD COLUMN IF NOT EXISTS "key_id" text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS "label" text,
  ADD COLUMN IF NOT EXISTS "scopes" text[] NOT NULL DEFAULT '{*}',
  ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_api_keys_key_id_idx" ON "agent_api_keys" ("key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_api_keys_agent_id_idx" ON "agent_api_keys" ("agent_id");
