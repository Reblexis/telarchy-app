-- Every comment on a workspace you belong to, by email (owner ask 2026-08-21:
-- "make sure that i get email regarding telarchy when any comment is written
-- ... make that a possible setting in the notification, so it's global, and
-- then toggle that setting on for viktor.cihal@gmail.com, should be off by
-- default of course").
--
-- OFF by default like notify_new_proposal, and for the same reason: the volume
-- is set by strangers rather than by the reader, so it is opt-in. An owner
-- watching a floor they run wants it; nobody else does.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notify_any_comment boolean NOT NULL DEFAULT false;

-- On for the owner, which is what the ask was for. Matched by email through
-- the auth user rather than by nickname, because the nickname can be changed
-- by its owner and the address is the thing the mail actually goes to.
UPDATE agents SET notify_any_comment = true
 WHERE auth_user_id IN (SELECT id FROM "user" WHERE lower(email) = 'viktor.cihal@gmail.com');
