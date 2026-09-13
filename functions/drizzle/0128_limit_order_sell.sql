-- Limit orders gain a sell side (docs/limit-orders.md). Additive only: every
-- existing row is a buy, and the two share columns stay null on buys.
ALTER TABLE "limit_orders" ADD COLUMN IF NOT EXISTS "side" text DEFAULT 'buy' NOT NULL;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD COLUMN IF NOT EXISTS "shares" double precision;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD COLUMN IF NOT EXISTS "filled_shares" double precision;
