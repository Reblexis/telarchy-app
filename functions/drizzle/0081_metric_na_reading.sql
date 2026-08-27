-- A reading can be N/A (owner direction 2026-08-27; docs/ui-conventions.md,
-- "A market on a number that does not exist resolves N/A"). NULL in
-- metrics.value / metric_logs.value is an explicit N/A reading; NULL in
-- updates.old_value / new_value records an N/A side of a change.
ALTER TABLE "metrics" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_logs" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "updates" ALTER COLUMN "old_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "updates" ALTER COLUMN "new_value" DROP NOT NULL;
