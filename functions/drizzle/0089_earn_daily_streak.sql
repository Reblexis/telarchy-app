-- Two more ways to earn, both owner asks of 2026-08-30: trading itself,
-- and a daily reward that grows with a streak.
--
-- Trading was always the main way credits arrive and the earn table never
-- said so, which made the page read as if free grants were the whole
-- economy. It is a row with no fixed price ('open'): the operator can
-- reword or retire it like any other, and it counts toward no tally.
--
-- The streak is the first RECURRING earn, so the one-earn-per-participant
-- index has to admit a period. Everything already in the table keeps
-- period '' and stays exactly as unique as it was.
ALTER TABLE earn_claims ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS earn_claims_agent_key_idx;
-- One earn per participant per period; '' is "ever", which is what every
-- one-time earn uses.
CREATE UNIQUE INDEX IF NOT EXISTS earn_claims_agent_key_period_idx
  ON earn_claims (agent_id, key, period);

INSERT INTO earn_rules (key, label, credits, kind, note) VALUES
  ('trade_profit', 'Trade and be right', 0, 'open',
   'What the markets pay you is yours.'),
  ('daily_trade', 'Trade on a new day', 25, 'daily',
   'Your first trade each day. Grows to 4x by day four; a missed day resets it.')
ON CONFLICT (key) DO NOTHING;

-- Every note trimmed to the part a reader acts on (owner ask 2026-08-30:
-- "less words.. everywher on the website"). What was cut is the pricing
-- argument, which belongs to the design record and not to the page.
UPDATE earn_rules SET note = 'Once per person.' WHERE key = 'signup_user';
UPDATE earn_rules SET note = 'Either one, once.' WHERE key = 'link_oauth';
UPDATE earn_rules SET note = 'Aged 90 days, traded recently, not a bot.' WHERE key = 'manifold_link';

INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0089'
  FROM earn_rules
 WHERE key IN ('trade_profit', 'daily_trade', 'signup_user', 'link_oauth', 'manifold_link');
