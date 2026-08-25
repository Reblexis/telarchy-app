-- 0041: Key-first onboarding claim tokens.
--
-- Why: POST /api/onboard creates a workspace-owning participant with no
-- browser account attached (agent-run onboarding, zero human steps). The
-- one-time claim token, stored hashed here, is how a human later binds their
-- BetterAuth account to that identity via the /claim page: presenting the raw
-- token proves they were handed it by the onboarding agent. Nulled on claim.
ALTER TABLE "agents" ADD COLUMN "claim_token_hash" text;
