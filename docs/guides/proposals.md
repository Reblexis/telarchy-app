---
title: Proposals & Decisions
description: How participants propose proposals, conditional markets measure expected impact, and admins decide.
category: forecast
order: 30
---
# Proposals & Decisions

Proposals are the mechanism for uncertainty. Any time you are unsure whether an action will improve a metric (whether the causal link is direct, indirect, or speculative), express it as a proposal rather than encoding the assumption into a metric definition. See *Metric Design* for the underlying principle.

Proposals are also the decision loop. A participant proposes an action; before the admin decides, the system runs prediction markets *conditionally*: participants forecast what the metrics would look like *if this proposal were completed*.

The result is per-metric impact predictions: quantitative forecasts of how much the proposal would move each metric. The admin approves or declines based on that signal.

## How it works

1. A participant proposes a proposal (`POST /api/proposals`) with a title, description, and optional `liquiditySubsidy` (credits per **branch** market). If omitted, subsidy is 0 (proposing is free, but conditional markets ship with zero liquidity and produce no signal).
2. Conditional markets are auto-created in **dual-branch** form: for every active leaf metric, two markets spawn under the proposal, one with `branch="approved"` (priced under the assumption the proposal is approved) and one with `branch="declined"` (priced under the assumption it is declined). If `liquiditySubsidy > 0`, the proposer is debited `liquiditySubsidy * leafMetricCount * 2` (subsidy per branch, two branches per metric) and each market gets a real LP row attributed to the proposer.
3. Participants forecast on both branches. The headline impact a human reads is `approved.consensus - declined.consensus` per metric, which isolates the causal effect of approving and removes contamination from the natural-trajectory baseline (which can itself price in expected approval).
4. Admin views the proposal detail: each metric row shows the decline-counterfactual and approve-counterfactual side by side with the signed delta. Admins can top up either branch via the inline **Add liquidity** button or via `POST /api/predictions/markets/liquidity/bulk { amount, proposalId }` (which injects equally into all branches under the proposal). Top-ups on a pending proposal are recorded as durable subsidy contributions and re-seeded into re-spawned markets when target dates roll, so the proposal's subsidy figure reflects them and the liquidity does not silently evaporate.
5. **Approve** - the **declined** branch is voided and refunded (the counterfactual never materialised), the **approved** branch stays live and resolves against the actual metric value at the target date. If the workspace has `proposalReward` set, the owner is debited and the proposer is paid the reward (skipped if 0; 409 if owner balance is insufficient).
6. **Decline** (good faith) - mirror image of approve. The **approved** branch is voided and refunded; the **declined** branch stays live and resolves against the actual metric, producing a counterfactual calibration record so we can score the decision later. No balance changes for the proposer.
7. **Decline as spam** (`POST /api/proposals/:id/decline-spam`) - both branches are voided (neither counterfactual materialised), and the proposer is charged up to `workspace.spamPenalty` (capped at their available balance) with the workspace owner credited.
8. **Withdraw** (`POST /api/proposals/:id/withdraw`) - proposer-only escape hatch. Voids both branches, no balance changes.

## Bounty model knobs

Proposals follow a bounty pattern: any participant can propose for free, the workspace owner reviews and decides, and credit movement is asymmetric across the four outcomes. Tune via `PUT /api/workspaces/:id/settings`:

- `proposalReward`: credits paid to the proposer on approve. Default 0 (purely market-driven incentive). Comes out of the workspace owner's balance.
- `spamPenalty`: credits taken from the proposer (paid to the owner) on decline-spam. Default 0. The penalty is best-effort: if the proposer's balance is below `spamPenalty`, only what they have is taken.
- `maxPendingProposalsPerParticipant`: optional throughput cap. Default 0 (disabled). When set to a positive integer, new submissions return 429 with `{ pending, cap }` once a participant has that many pending proposals.

Public-marketplace listings (`GET /api/marketplace/workspaces/public`) surface 30-day proposal stats per workspace so participants can read how an owner reviews before they propose. A workspace with a high spam-decline rate self-corrects: proposers stop coming.

## Inspect mode

On the Proposals page, clicking **Inspect** on a proposal sets a `?proposal=<id>` URL param. The Metrics and Markets pages then show conditional predictions for that proposal alongside the baseline. The purple banner at the bottom of the screen indicates you are in inspect mode. Click *Exit Inspect* to return to normal view, or open a second browser tab with a different `?proposal=` to compare proposals side-by-side.

## Metrics and proposal quality

Well-structured metrics make the proposal loop more informative. If your metrics are too coarse (few leaves, vague values) the conditional markets can't produce a meaningful signal.

Best practices:

- Keep leaf metrics specific and directly measurable rather than broad and vague.
- Set accurate market ranges. A mis-ranged market produces a useless consensus.
- Inject liquidity into markets so the AMM has price sensitivity for participant predictions.
- Refresh markets after making structural changes to the metric tree.
