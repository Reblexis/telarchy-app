-- 0018: Add a nullable `outlook` column to metric_logs so the Graph modal can
-- plot both the user-authored current value and the computed outlook (total)
-- for leaves with Time Preference enabled. Commit 05ae34e narrowed the logged
-- value to m.value for leaves, which is what the user edits, but dropped the
-- outlook history entirely. Storing both lets us show two lines where they
-- diverge, one line otherwise.

ALTER TABLE "metric_logs" ADD COLUMN IF NOT EXISTS "outlook" double precision;
