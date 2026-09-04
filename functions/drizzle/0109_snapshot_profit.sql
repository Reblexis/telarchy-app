-- The daily participant snapshot records the board's marked profit beside
-- the balance (telarchy-app docs/ui-conventions.md, "The participant
-- profile"). Nullable: rows from before this migration are not profit
-- history.
ALTER TABLE "agent_balance_snapshots" ADD COLUMN IF NOT EXISTS "profit" double precision;
