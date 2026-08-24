-- The notification matrix's web and mobile cells (owner ask 2026-08-24:
-- per-kind settings with web, email and mobile channels, like Manifold's).
-- Overrides only: a missing cell means its default (lib/notification-prefs.ts),
-- so nobody needs a backfill and a new kind needs no migration.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notification_channels jsonb;

-- One browser's push subscription: the mobile channel's address.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  endpoint text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_agent_idx ON push_subscriptions (agent_id);
