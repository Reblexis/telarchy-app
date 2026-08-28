-- A season's pool can be paid two ways: the original rank ladder, or split
-- among entrants in proportion to positive settled score (rules amendment
-- 2026-08-28; design record in the telarchy umbrella,
-- notes/trader-rewards-design-2026-08-28.md). Existing rows keep 'ladder',
-- the only mode that existed before this column.
ALTER TABLE prize_seasons ADD COLUMN IF NOT EXISTS payout_mode text NOT NULL DEFAULT 'ladder';
-- Proportional mode only: a computed share below this is not paid and rolls
-- into the next season's pool (dust costs more to send than it is worth).
ALTER TABLE prize_seasons ADD COLUMN IF NOT EXISTS min_payout_usd double precision NOT NULL DEFAULT 0;
