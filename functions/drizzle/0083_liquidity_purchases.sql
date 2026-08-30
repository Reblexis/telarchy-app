-- Paid market liquidity (Stripe Checkout), the only path by which real money
-- enters the managed instance (owner decision 2026-08-28; design records in
-- the telarchy umbrella, notes/real-money-economy-design-2026-08-26.md
-- approach A and notes/trader-rewards-design-2026-08-28.md). A purchase is
-- fulfilled by the webhook: credits are minted evenly into the workspace's
-- open market pools, never into any balance.
CREATE TABLE IF NOT EXISTS liquidity_purchases (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  usd_amount double precision NOT NULL,
  credits double precision NOT NULL,
  credits_per_usd double precision NOT NULL,
  stripe_session_id text,
  status text NOT NULL DEFAULT 'pending',
  allocation jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);
CREATE INDEX IF NOT EXISTS liquidity_purchases_ws_idx ON liquidity_purchases (workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS liquidity_purchases_session_idx ON liquidity_purchases (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
