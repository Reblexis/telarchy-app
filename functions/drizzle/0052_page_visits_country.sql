-- 0052: country of origin for page visits (owner ask 2026-08-11).
-- Offline IP -> country (ISO alpha-2) is recorded at log time so the
-- /admin launch cockpit can show where traffic comes from, alongside the
-- specific IPs. Nullable; fills in naturally as new visits arrive.
ALTER TABLE "page_visits" ADD COLUMN IF NOT EXISTS "country" text;
