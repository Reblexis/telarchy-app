-- Every earn becomes something you can DO, and each is claimable once
-- (owner ask 2026-08-30: connecting Google or GitHub should earn credits,
-- listed like a quest table; design
-- https://claude.ai/code/artifact/3d605cc3-5d42-450e-bb42-3f07b21bcb38).
--
-- The model change: the price used to hang off signup (email 100, OAuth
-- 300), so somebody who signed up with an email could never earn the OAuth
-- difference. It is decomposed instead: creating an account pays 100, and
-- each proof you attach pays separately. Signing up with Google still
-- totals 300; an email signup can now come back and connect one.
CREATE TABLE IF NOT EXISTS earn_claims (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  key text NOT NULL,
  -- The external thing that was proved: a provider account id, a Manifold
  -- user id. Null for earns that prove nothing external (the signup row).
  ref_id text,
  credits double precision NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
-- One earn per participant, ever.
CREATE UNIQUE INDEX IF NOT EXISTS earn_claims_agent_key_idx ON earn_claims (agent_id, key);
-- THE LOAD-BEARING RULE: one external account pays once across the whole
-- platform. Without it a single Google account funds ten Telarchy
-- accounts, which is the farm the prices exist to stop.
CREATE UNIQUE INDEX IF NOT EXISTS earn_claims_key_ref_idx ON earn_claims (key, ref_id) WHERE ref_id IS NOT NULL;

-- ONE connectable proof, either provider (owner decision 2026-08-30:
-- "lets make it connect google acc or github"). The second account you
-- attach proves much less than the first - it is the same person proving
-- they hold another free account - so it earns nothing.
INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('link_oauth', 'Connect a Google or GitHub account', 200, 'flat',
   'An aged account of either costs about a dollar to buy; this sits below that. Either one earns it, once.')
ON CONFLICT (key) DO NOTHING;

-- Signup collapses back to one row: the provider is now paid for
-- separately, by its own link row.
UPDATE earn_rules
   SET credits = 100, label = 'Create an account', note = 'One per person. The provider you used is paid for separately below.'
 WHERE key = 'signup_user';
UPDATE earn_rules SET enabled = false, note = 'Retired 2026-08-30: superseded by "Create an account" plus the link rows.'
 WHERE key IN ('signup_email', 'signup_oauth');

INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0087'
  FROM earn_rules
 WHERE key IN ('signup_user', 'signup_email', 'signup_oauth', 'link_oauth');

-- Existing accounts keep what they were granted and are marked as having
-- claimed what they already hold, so nobody is paid twice and nobody sees
-- an earn they already had offered back to them. Their OAuth links count
-- as claimed against the provider account that is already attached.
INSERT INTO earn_claims (id, agent_id, key, ref_id, credits)
SELECT gen_random_uuid()::text, a.id, 'signup_user', NULL, 0
  FROM agents a
 WHERE a.auth_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- One claim per existing participant, against whichever provider account
-- they already have attached. DISTINCT ON the agent, because somebody with
-- both Google and GitHub linked must still end up with exactly one claim:
-- the unique index would reject the second, and silently dropping it is
-- not something a backfill should rely on.
INSERT INTO earn_claims (id, agent_id, key, ref_id, credits)
SELECT DISTINCT ON (a.id)
       gen_random_uuid()::text,
       a.id,
       'link_oauth',
       acc.account_id,
       0
  FROM agents a
  JOIN account acc ON acc.user_id = a.auth_user_id
 WHERE a.auth_user_id IS NOT NULL
   AND acc.provider_id IN ('google', 'github')
 ORDER BY a.id, acc.created_at
ON CONFLICT DO NOTHING;
