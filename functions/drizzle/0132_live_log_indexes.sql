-- The public actions log reads a floor's decisions and deliveries in the size
-- of a page (docs/data-room.md). A floor deciding a proposal a second
-- had its whole history sorted on every Live read: the decision instant was a
-- CASE computed per row, which no index can order. It is now a generated
-- column, backfilled by Postgres as the column is added, and indexed.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "decided_at" timestamp GENERATED ALWAYS AS (CASE WHEN status = 'lapsed' THEN COALESCE(lapsed_at, closed_at, resolved_at) WHEN status = 'withdrawn' THEN COALESCE(closed_at, resolved_at) WHEN status IN ('approved', 'declined', 'declined_spam') THEN resolved_at END) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_ws_decided_idx" ON "proposals" ("workspace_id", "decided_at") WHERE "decided_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_ws_delivered_idx" ON "proposals" ("workspace_id", "delivered_at") WHERE "delivered_at" IS NOT NULL;
