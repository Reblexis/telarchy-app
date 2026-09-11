-- The owner's feed of the thing the market steers, drawn natively on the
-- floor's LIVE segment (docs/ui-conventions.md, "The live view is a segment
-- of the chart slot"; owner ask 2026-09-11). { kind, url } or null; null is
-- every existing workspace and means no LIVE segment. live_view_url stays,
-- deprecated, for a floor that has only it.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "live_feed" jsonb;
