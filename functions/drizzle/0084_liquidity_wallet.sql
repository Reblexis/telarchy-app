-- The second currency (owner decision 2026-08-28, verbatim: "they will have
-- two currencies if its they buy liquidity currency the liquidity currency
-- shows up and they can use that currency when injecting liqudity in
-- individual markets"). A liquidity purchase credits this walled wallet
-- instead of spreading into pools; injections spend the wallet first; LP
-- leftovers from wallet-funded injections return to the wallet, never to
-- the tradeable balance, which is what keeps bought credits from ever
-- becoming stake.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS liquidity_balance bigint NOT NULL DEFAULT 0;
-- Which purse funded an injection ('balance' | 'liquidity'); legacy rows
-- (null) read as 'balance'.
ALTER TABLE liquidity_events ADD COLUMN IF NOT EXISTS funded_from text;
