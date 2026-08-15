-- Where a waitlist signup came from: the marketplace's "List your own number"
-- tile, or one workspace's own floor door. Both post to the same endpoint, so
-- without this every signup looked identical and the owner could not tell
-- which surface is actually converting (owner ask 2026-08-15). Nullable: rows
-- written before this column exists keep NULL and read as "unknown".
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "source" text;
