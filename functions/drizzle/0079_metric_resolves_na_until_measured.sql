-- A metric declares that its markets resolve N/A until it has been measured.
--
-- Default false, and every existing row: a market with no reading before its
-- boundary falls back to the live value, as it always did. Set, the metric is
-- a number that does not exist until an event happens (the valuation implied
-- by an investment, owner ask 2026-08-25): a market whose instant passes with
-- no logged reading at or before it is VOIDED, every position refunded, rather
-- than settled on the default 0. The first reading ends the state for good.
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS resolves_na_until_measured boolean NOT NULL DEFAULT false;
