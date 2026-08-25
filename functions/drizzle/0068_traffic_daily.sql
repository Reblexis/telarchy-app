-- Visits and unique addresses per day, kept forever (owner ask 2026-08-20:
-- the data room publishes traffic).
--
-- page_visits is purged at 30 days by the privacy policy. Without a rollup the
-- public traffic history would be capped at one month for as long as the site
-- exists, which is not a history, it is a window. This table holds two counts
-- and a date: no IP, no path, no user-agent, no referer. That is what makes
-- keeping it forever compatible with purging the log it is derived from.
CREATE TABLE IF NOT EXISTS "traffic_daily" (
  "day" text PRIMARY KEY,
  "visits" integer NOT NULL,
  "uniques" integer NOT NULL
);
