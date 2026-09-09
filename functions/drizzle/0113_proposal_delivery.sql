-- Whether the approved work actually happened (docs/guides/proposals.md,
-- "After approval: say whether it happened"). Approval was the last thing the
-- record held, so a forecaster could not tell a market that was wrong from a
-- promise that was not kept. Every existing approved proposal starts at
-- not_started, which is the truth: nobody has said otherwise yet.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "delivery_state" text NOT NULL DEFAULT 'not_started';
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "delivery_note" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
