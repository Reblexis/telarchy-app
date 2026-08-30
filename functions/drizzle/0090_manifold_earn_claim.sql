-- The Manifold import never recorded an earn claim (owner report
-- 2026-08-30: "if someone has already manifold imported it shouldnt show
-- as avilable it do3es now").
--
-- The import predates `earn_claims`: it moved credits with applyCredits
-- and recorded its own idempotency in `system_config`, so /earn had no way
-- to know it had happened and kept offering the row. The route now writes
-- the claim; this backfills everyone who imported before it did.
--
-- The `manifold-claimed:user:<manifoldUserId>` rows are the ones to read,
-- because the key carries the external account and the value carries the
-- participant and what they were paid. That external id becomes the
-- claim's ref_id, which is what puts historical imports under the same
-- rule as new ones: one Manifold account pays once across the platform.
INSERT INTO earn_claims (id, agent_id, key, ref_id, credits, period, created_at)
SELECT gen_random_uuid()::text,
       c.value->>'agentId',
       'manifold_link',
       substring(c.key from 'manifold-claimed:user:(.*)'),
       -- What they were actually paid on the day, not today's price.
       coalesce((c.value->>'granted')::double precision, 0),
       '',
       coalesce(to_timestamp((c.value->>'at')::bigint / 1000.0), now())
  FROM system_config c
  -- Join, so a claim can never name a participant that no longer exists.
  JOIN agents a ON a.id = c.value->>'agentId'
 WHERE c.key LIKE 'manifold-claimed:user:%'
   AND c.value->>'agentId' IS NOT NULL
ON CONFLICT DO NOTHING;
