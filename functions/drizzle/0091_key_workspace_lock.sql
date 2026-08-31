-- A key pinned to one workspace: X-Workspace-Id can no longer move it
-- elsewhere (docs/guides/auth-and-keys.md, "A key can be pinned to one
-- workspace"). Default false, so every key that exists keeps behaving as it
-- did, and the market page's "only on this market" choice is the one that
-- sets it.
ALTER TABLE "agent_api_keys" ADD COLUMN "workspace_locked" boolean DEFAULT false NOT NULL;
