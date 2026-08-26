-- Funding packages, the liquidity budget, workspace prize pools and payouts
-- (docs/liquidity.md, docs/workspace-pools.md). Real money enters one way:
-- an owner pays for liquidity on their own markets and sponsors a monthly
-- cash pool that Telarchy pays to traders by settled profit. Credits stay
-- play money: the budget can only be injected into this workspace's markets,
-- never traded, transferred or paid out (the wall that keeps a bought credit
-- from ever being a trader's stake).
ALTER TABLE "workspaces" ADD COLUMN "liquidity_budget" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "liquidity_weights" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "liquidity_events" ADD COLUMN "funded_by" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
CREATE TABLE "liquidity_budget_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "delta_units" bigint NOT NULL,
  "balance_after_units" bigint NOT NULL,
  "reason" text NOT NULL,
  "ref_type" text,
  "ref_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "liquidity_budget_ledger_ws_created_idx" ON "liquidity_budget_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE TABLE "funding_purchases" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "buyer_agent_id" text,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "credits_units" bigint NOT NULL,
  "pool_cents" integer NOT NULL,
  "pool_month" text NOT NULL,
  "credits_per_usd" integer NOT NULL,
  "pool_fraction_bp" integer NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_session_id" text NOT NULL,
  "provider_payment_ref" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "paid_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX "funding_purchases_provider_session_idx" ON "funding_purchases" USING btree ("provider_session_id");--> statement-breakpoint
CREATE INDEX "funding_purchases_ws_idx" ON "funding_purchases" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE TABLE "workspace_pools" (
  "workspace_id" text NOT NULL,
  "month" text NOT NULL,
  "pool_cents" integer DEFAULT 0 NOT NULL,
  "rollover_cents" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "rules" jsonb,
  "frozen_at" timestamp,
  "settled_at" timestamp,
  "distributed_cents" integer DEFAULT 0 NOT NULL,
  "void_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_pools_workspace_id_month_pk" PRIMARY KEY("workspace_id","month")
);--> statement-breakpoint
CREATE TABLE "workspace_pool_results" (
  "workspace_id" text NOT NULL,
  "month" text NOT NULL,
  "agent_id" text NOT NULL,
  "score_units" bigint NOT NULL,
  "trade_count" integer DEFAULT 0 NOT NULL,
  "market_count" integer DEFAULT 0 NOT NULL,
  "early_trade_count" integer DEFAULT 0 NOT NULL,
  "eligible" boolean DEFAULT false NOT NULL,
  "exclusion" text,
  "share" double precision DEFAULT 0 NOT NULL,
  "payout_cents" integer DEFAULT 0 NOT NULL,
  "rank" integer,
  CONSTRAINT "workspace_pool_results_workspace_id_month_agent_id_pk" PRIMARY KEY("workspace_id","month","agent_id")
);--> statement-breakpoint
CREATE TABLE "payouts" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "source_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "state" text DEFAULT 'accrued' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "paid_at" timestamp,
  "paid_note" text
);--> statement-breakpoint
CREATE INDEX "payouts_agent_idx" ON "payouts" USING btree ("agent_id","state");--> statement-breakpoint
-- Money ledgers are append-only, like trades and credit_ledger (0055, 0060).
DROP TRIGGER IF EXISTS liquidity_budget_ledger_append_only ON "liquidity_budget_ledger";--> statement-breakpoint
CREATE TRIGGER liquidity_budget_ledger_append_only
  BEFORE UPDATE OR DELETE ON "liquidity_budget_ledger"
  FOR EACH ROW EXECUTE FUNCTION telarchy_ledger_append_only();
