-- 0051: Visitor logging for the public floor (owner ask 2026-08-11):
-- every document load the server serves gets one row, so the /admin
-- page can show launch traffic (visits, uniques, referers) beside
-- signups. Covered by the privacy policy's request-log clause; purged
-- past 30 days whenever the stats are read.
CREATE TABLE IF NOT EXISTS "page_visits" (
  "id" text PRIMARY KEY,
  "ts" timestamp DEFAULT now() NOT NULL,
  "path" text NOT NULL,
  "referer" text,
  "user_agent" text,
  "ip" text
);
CREATE INDEX IF NOT EXISTS "page_visits_ts_idx" ON "page_visits" ("ts");
