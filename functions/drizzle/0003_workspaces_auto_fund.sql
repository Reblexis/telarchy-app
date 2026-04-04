ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "auto_fund_new_markets" boolean NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "new_market_liquidity_credits" double precision NOT NULL DEFAULT 0;
