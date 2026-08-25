-- 0047: Resting limit orders.
--
-- Why: these markets are LMSR, so there is no counterparty and a thin market
-- cannot absorb conviction. A trader who thinks the number is $60k against a
-- market at $73.6k either eats the whole move alone at a worse average price
-- than the one they believe in, or does nothing. A resting order lets them
-- say "down to $65k and no further" and be filled by whoever pushes into
-- them later. It is also the honest complement to the position cap: the cap
-- bounds how hard one account can shove at once; limit orders let the same
-- conviction be expressed over time instead.
--
-- budget_credits is DEBITED at placement (see docs/limit-orders.md), so this
-- table holds reserved money, not intentions. filled_credits tracks how much
-- has executed; cancel or expiry refunds the remainder.
--
-- limit_value is in metric space (dollars), not probability: the page speaks
-- dollars and a trader should never have to convert.
CREATE TABLE IF NOT EXISTS "limit_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "market_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "direction" text NOT NULL,
  "limit_value" double precision NOT NULL,
  "budget_credits" double precision NOT NULL,
  "filled_credits" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- The fill pass runs on every trade in a market, so the hot lookup is
-- "open orders on this market"; the owner index serves the trader's own list.
CREATE INDEX IF NOT EXISTS "limit_orders_market_open_idx" ON "limit_orders" ("market_id", "status");
CREATE INDEX IF NOT EXISTS "limit_orders_agent_idx" ON "limit_orders" ("agent_id", "status");
