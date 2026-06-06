-- 0038: Daily participant balance snapshots.
--
-- Balance mutations have no unified ledger (resolution payouts, LP leftover
-- distributions, and admin credit grants update agents.balance in place), so
-- a balance-over-time graph cannot be reconstructed retroactively. The hourly
-- resolve cron writes one snapshot per participant per UTC day (idempotent on
-- the composite PK). Powers the balance graph on the public profile.

CREATE TABLE IF NOT EXISTS "agent_balance_snapshots" (
  "agent_id" text NOT NULL,
  "day" text NOT NULL,
  "balance" bigint NOT NULL,
  CONSTRAINT "agent_balance_snapshots_pk" PRIMARY KEY ("agent_id", "day")
);
