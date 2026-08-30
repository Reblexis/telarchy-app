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
   'Every credit a market pays you is yours to keep. This is the only earn with no ceiling.'),
  ('daily_trade', 'Trade on a new day', 25, 'daily',
   'Paid the first time you trade each day, and it grows with the streak: 25 on day one, then 50, 75, and 100 a day from day four. Miss a day and it starts again.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO earn_rule_history (id, key, credits, kind, enabled, note, changed_by)
SELECT gen_random_uuid()::text, key, credits, kind, enabled, note, 'migration 0089'
  FROM earn_rules
 WHERE key IN ('trade_profit', 'daily_trade');
