-- What the market actually settled on, and whether anyone was told it was
-- about to settle on something old (docs/guides/sources.md, "Stale at the
-- boundary is said out loud").
--
-- settled_reading_at: the timestamp of the reading the resolver used, so the
-- settlement can say how old it was, for good, rather than leaving a trader to
-- work it out from two logs.
--
-- stale_notice_at: when the owner was last emailed that this market was about
-- to settle on a stale reading. Dedupe only; the bell derives its own state
-- every read and needs no column.
ALTER TABLE "markets" ADD COLUMN "settled_reading_at" timestamp;
ALTER TABLE "markets" ADD COLUMN "stale_notice_at" timestamp;
