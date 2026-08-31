-- A redemption is not a trade in any list a person reads.
--
-- Buying the side opposite a position redeems the matched pairs at par, and
-- that redemption writes two rows (one per side) so the price replay, which
-- rebuilds the book by walking this table, still solves for the right book.
-- Every human-facing list classified a negative cost as a sell, so one buy
-- appeared as three trades under the trader's name (participant report
-- 2026-08-31). This column marks the bookkeeping rows.
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'trade';

-- Backfill the redemptions written before the column existed. A redemption is
-- the only thing that writes two rows for one participant, on one market, at
-- the identical instant, on opposite sides, for the same negative number of
-- shares: two independent sells cannot share a timestamp to the microsecond,
-- since each is its own transaction.
--
-- `trades` is append-only by trigger (0055), so this opts in the sanctioned
-- way. Nothing a market settles on is touched: shares, cost, direction and
-- instant all stand, and only the classification of the row is written.
DO $$
BEGIN
  PERFORM set_config('telarchy.ledger_admin', 'on', true);
  UPDATE "trades" t SET "kind" = 'redeem'
  FROM "trades" o
  WHERE o."workspace_id" = t."workspace_id"
    AND o."agent_id" = t."agent_id"
    AND o."market_id" = t."market_id"
    AND o."created_at" = t."created_at"
    AND o."direction" <> t."direction"
    AND o."shares" = t."shares"
    AND t."shares" < 0;
END $$;
