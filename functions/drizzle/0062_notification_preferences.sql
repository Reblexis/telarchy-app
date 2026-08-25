-- Participant email notifications (owner ask 2026-08-19). Three switches per
-- participant, on their own row, because the person who decides whether an
-- email is wanted is the person the email is about.
--
-- Defaults are split on purpose (docs/vision.md, "Participant email
-- notifications"): the two that fire on an answer addressed TO YOU are on,
-- because a comment box that never tells you someone replied is a promise the
-- product does not keep. The new-contract firehose, whose volume strangers
-- set, is off until asked for.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "notify_comment_on_my_proposal" boolean NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "notify_reply_to_my_comment" boolean NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "notify_new_proposal" boolean NOT NULL DEFAULT false;
