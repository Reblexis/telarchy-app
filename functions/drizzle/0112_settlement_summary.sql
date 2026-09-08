-- The settlement line (docs/ui-conventions.md, "The numbers band and the
-- settlement line"): one owner-written line under the floor's numbers band,
-- "Settles on: ...". Nullable on purpose: a metric with no summary falls back
-- to the first sentence of its definition on the client, so the column adds
-- nothing until an owner writes it. Additive, no backfill.
ALTER TABLE "metrics" ADD COLUMN IF NOT EXISTS "settlement_summary" text;
