-- 0049: Payment setup lives on the ACCOUNT, not the proposal (owner
-- decision 2026-08-10 evening): a person describes once how they receive
-- money, and posting any paid job requires it; $0 jobs do not. The
-- per-proposal column from 0048 remains as the snapshot taken at listing
-- time, so an approved job's payment target cannot be edited after the
-- fact by changing the account.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "payout_handle" text;
