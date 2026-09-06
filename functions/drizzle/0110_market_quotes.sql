-- A conditional pair prices the difference from the baseline
-- (docs/guides/creating.md; docs/market-integrity.md I1c; owner decision
-- 2026-09-05). Every existing row keeps the level rule: baseline markets are
-- levels by definition, and a conditional pair anyone had traded stays a
-- level book for its holders' sake. Untraded pending pairs are reopened as
-- difference books by the next refresh, in code, where the LMSR lives.
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "quotes" text NOT NULL DEFAULT 'level';
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "reference_value" double precision;
