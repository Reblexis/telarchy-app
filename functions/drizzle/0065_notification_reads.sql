-- Per-item read state for the notifications inbox (owner ask 2026-08-19:
-- "one less per click on the new stuff").
--
-- The watermark on agents (notifications_seen_at) answers "read everything",
-- which is the cheap 90% case and stays. It cannot answer "I read THIS one",
-- because the inbox is derived from several tables and its items are not in
-- one order a single cursor can walk. So a read item gets a row here, and the
-- watermark keeps meaning "and everything older than this".
--
-- Rows are disposable: moving the watermark deletes this participant's rows,
-- since everything up to now is read by definition and keeping them would
-- grow a table nobody reads.
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "agent_id" text NOT NULL,
  "item_id" text NOT NULL,
  "read_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "notification_reads_pk" PRIMARY KEY ("agent_id", "item_id")
);
