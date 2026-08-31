-- Settling after the period, not at the instant it ends
-- (docs/guides/sources.md, "The number is final after the period, not at it").
--
-- metrics.settlement_lag_minutes: how long after a period this metric's number
-- is final. A monthly total that needs three days of refunds to be true says
-- 4320 here, and its markets settle then.
--
-- markets.settles_at: the instant THIS market settles, stamped when it opens
-- from the metric's lag at that moment. Stored rather than derived so that
-- changing the lag can never move the settlement of a market people are
-- already trading.
ALTER TABLE "metrics" ADD COLUMN "settlement_lag_minutes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "markets" ADD COLUMN "settles_at" timestamp;
