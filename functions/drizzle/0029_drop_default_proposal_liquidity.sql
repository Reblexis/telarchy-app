-- 0029: Drop workspaces.default_proposal_liquidity.
--
-- The bounty model (migration 0028) made spam resistance the workspace owner's
-- explicit knobs (proposalReward, spamPenalty, maxPendingProposalsPerParticipant).
-- The old default_proposal_liquidity column auto-debited the proposer at submit
-- time when liquiditySubsidy was omitted, which is a hidden submission fee and
-- contradicts the bounty model's "proposing is free" invariant. Liquidity now
-- comes from two opt-in sources only:
--   1. The proposer voluntarily passing liquiditySubsidy on POST /api/proposals.
--   2. A workspace admin injecting liquidity post-hoc via
--      POST /api/predictions/markets/liquidity/bulk { amount, proposalId }.

ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "default_proposal_liquidity";
