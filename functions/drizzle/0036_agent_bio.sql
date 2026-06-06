-- 0036: Participant bio.
--
-- Freeform public description on the agents (participants) table: who this
-- participant is and what it is in Telarchy to do. Max 500 chars (enforced
-- at the API layer). Set at registration (POST /api/agents/register,
-- POST /api/agents) or later via POST /api/auth/profile; shown on the
-- public participant profile.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "bio" text;
