-- One badge, one key shape.
--
-- Until 2026-09-01 a Manifold link was written by its own route, which
-- recorded the linked handle at `manifold-claimed:agent:<agentId>` and
-- burned the Manifold account at `manifold-claimed:user:<externalId>`.
-- That route has been deleted: every provider now goes through the
-- record-link router, which records the handle at
-- `record-handle:<provider>:<agentId>` and leaves uniqueness to the
-- unique index on `earn_claims (key, ref_id)`.
--
-- So the ten links made under the old route are rewritten into the new
-- shape, or their owners would silently lose the badge on their profile
-- and on the leaderboard. Their `earn_claims` rows already exist and are
-- untouched, which is why dropping the `:user:` guard rows loses nothing:
-- the index that stopped one Manifold account paying twice is the same
-- one it was before.
INSERT INTO "system_config" ("key", "value")
SELECT
  'record-handle:manifold:' || replace("key", 'manifold-claimed:agent:', ''),
  jsonb_build_object(
    'handle',     "value" ->> 'username',
    'externalId', "value" ->> 'manifoldUserId',
    'granted',    ("value" ->> 'granted')::numeric,
    'at',         ("value" ->> 'at')::numeric
  )
FROM "system_config"
WHERE "key" LIKE 'manifold-claimed:agent:%'
  AND "value" ->> 'username' IS NOT NULL
ON CONFLICT ("key") DO NOTHING;

DELETE FROM "system_config" WHERE "key" LIKE 'manifold-claimed:%';
