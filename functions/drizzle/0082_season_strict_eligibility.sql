-- The two platform eligibility rules for seasons after Season 0 (design
-- record in the telarchy umbrella, notes/real-money-economy-design-2026-08-26.md
-- premise 4, applied 2026-08-28): accounts that own or administer any public
-- workspace take no payout, and entries sharing a payout handle collapse to
-- the best-placed one. Existing rows (Season 0) get FALSE, because Season 0's
-- published rules (amended 2026-08-25) made owners explicitly eligible and an
-- eligibility flip mid-season would reduce standings, which its amendment
-- clause forbids; new seasons default TRUE.
ALTER TABLE prize_seasons ADD COLUMN IF NOT EXISTS strict_eligibility boolean NOT NULL DEFAULT false;
ALTER TABLE prize_seasons ALTER COLUMN strict_eligibility SET DEFAULT true;
