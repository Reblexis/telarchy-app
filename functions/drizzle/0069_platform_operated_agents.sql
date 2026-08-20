-- Season 0 rules, published 2026-08-17: "Participants operated by us or run as
-- part of the platform are not eligible." Until now nothing enforced it: the
-- only eligibility test was score > 0, and on the eve of Season 0 the operator's
-- own trading bot sat top of the standings of a $1,000 cash contest.
--
-- The flag lives on the participant rather than in a config list, because
-- settlement assigns real money and needs to answer "may this account take a
-- rung" from the same row it reads everything else about them from.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS platform_operated boolean NOT NULL DEFAULT false;

-- The house set as it stands on 2026-08-20. Matched by id where the id is the
-- name (the sync jobs) and by nickname otherwise. Additive and idempotent: a
-- rerun sets the same rows to the same value.
UPDATE agents SET platform_operated = true
WHERE id IN ('lookpilot-kpi-sync', 'lookpilot-roadmap', 'telarchy-self-sync', 'admin')
   OR nickname IN ('telarchy-agents', 'lookpilot-kpi-sync', 'lookpilot-roadmap', 'telarchy-self-sync', 'adminbot');
