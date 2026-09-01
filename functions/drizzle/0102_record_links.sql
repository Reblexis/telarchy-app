-- A link is who you are; an earn claim is what you were paid.
--
-- Until now the two were the same decision: a record that failed the
-- quality gates could not be linked at all, so a fresh or dormant account
-- had no badge, no handle on the leaderboard, nothing. Owner ask
-- 2026-09-01: linking should be open to anyone who can prove they hold
-- the account, "jus tfor the fun of it being linked and people seeing
-- whos who", with the gates left to decide only the money.
--
-- So the badge gets its own table and stops living in system_config.
-- The primary key is one link per participant per provider; the unique
-- index is one participant per external account, so two profiles never
-- claim to be the same forecaster. Neither constraint touches
-- `earn_claims`, which keeps both payment rules: one payment per
-- participant per provider, and one per external account across the
-- platform. That separation is what lets a link be replaced freely,
-- paid or not, without a second grant becoming possible.
CREATE TABLE IF NOT EXISTS "record_links" (
  "agent_id" text NOT NULL,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "handle" text NOT NULL,
  "linked_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "record_links_agent_id_provider_pk" PRIMARY KEY ("agent_id", "provider")
);

CREATE UNIQUE INDEX IF NOT EXISTS "record_links_provider_external_idx"
  ON "record_links" ("provider", "external_id");

-- The badges written by the two shapes this table replaces: the
-- record-link router's `record-handle:<provider>:<agentId>` key, and the
-- `manifold-claimed:agent:<agentId>` key from the Manifold route deleted
-- earlier today, which migration 0100 should already have rewritten.
-- Both are read here so an instance that skipped a step still keeps its
-- badges.
INSERT INTO "record_links" ("agent_id", "provider", "external_id", "handle")
SELECT
  split_part("key", ':', 3),
  split_part("key", ':', 2),
  COALESCE("value" ->> 'externalId', ''),
  "value" ->> 'handle'
FROM "system_config"
WHERE "key" LIKE 'record-handle:%'
  AND "value" ->> 'handle' IS NOT NULL
  AND "value" ->> 'externalId' IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "record_links" ("agent_id", "provider", "external_id", "handle")
SELECT
  replace("key", 'manifold-claimed:agent:', ''),
  'manifold',
  COALESCE("value" ->> 'manifoldUserId', ''),
  "value" ->> 'username'
FROM "system_config"
WHERE "key" LIKE 'manifold-claimed:agent:%'
  AND "value" ->> 'username' IS NOT NULL
  AND "value" ->> 'manifoldUserId' IS NOT NULL
ON CONFLICT DO NOTHING;

DELETE FROM "system_config" WHERE "key" LIKE 'record-handle:%' OR "key" LIKE 'manifold-claimed:%';
