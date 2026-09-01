-- A reading that says the number does not exist for this period, rather than
-- that it is zero (owner ask 2026-09-01: "it should be possible to update
-- value as n/a (unknown) ... it just means the corresponding markets resolve
-- n/a"). The market whose fixing lands on such a reading voids as N/A and
-- refunds every position, the same path resolvesNaUntilMeasured already used
-- for a metric nobody had ever read.
ALTER TABLE "metric_logs" ADD COLUMN "na" boolean DEFAULT false NOT NULL;
