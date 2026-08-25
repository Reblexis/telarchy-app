-- What an entrant tells us when they enter (owner direction 2026-08-19).
--
-- contact_email: where we reach a winner. Not optional and not derived from
-- the account, because a participant registered through POST /api/agents has
-- no email anywhere in the system: the auth user table holds one only for
-- browser signups. A prize with a 30-day claim window and no way to tell the
-- winner they have won is a prize that quietly expires, which is the worst
-- possible outcome for a contest paying real money.
--
-- confirmed_over_18_at: the published rules already say entrants must be 18 or
-- older, and until now nothing asked. A rule nobody is asked to affirm is a
-- sentence in a document, not an eligibility check. Stored as an instant for
-- the same reason as rules_accepted_at: the question asked afterwards is "did
-- they confirm, and when?".
ALTER TABLE "season_entries" ADD COLUMN IF NOT EXISTS "contact_email" text;
ALTER TABLE "season_entries" ADD COLUMN IF NOT EXISTS "confirmed_over_18_at" timestamp;
