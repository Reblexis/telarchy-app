-- What Otto did while answering (owner direction 2026-08-21: he acts with the
-- caller's own API access now, trades included).
--
-- The question log already records who asked and what they asked. This adds
-- what was DONE about it: [{ method, path, status }] per row. Acting on
-- someone's behalf with no record of the calls is the part that could not be
-- defended after the fact, and it is one column.
ALTER TABLE "floor_questions" ADD COLUMN IF NOT EXISTS "tool_calls" jsonb;
