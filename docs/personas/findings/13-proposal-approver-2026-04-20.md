# Persona findings: Chen, the proposal approver

Date: 2026-04-20. Executor: Claude. Budget: 10 min. Used: ~5 min.

Note: overlap with persona 11 (Priya) — same workspace, same session, same proposal, but viewing the flow with an approver's mental model.

## Outcome

Bounce with loss of trust. Chen (acting via Priya's admin account) approves a proposal with one click, no confirmation, no visible consequence. After the click: status silently flips to APPROVED, Approve/Decline buttons vanish, no toast, no audit trail visible in the UI. The money path works (`earnedProposals` +50 on the proposer agent), but a careful approver has no way to see that from the screen. The IMPACT PREDICTIONS table never shows baseline vs conditional, so the decision is made essentially blind.

## Session log

1. T+00:00 — Navigate to `/proposals`. No "Proposals" count badge in the sidebar. No "needs your attention" banner. A freshly-proposed proposal needing approval is not signposted anywhere. An admin with 20 proposals would miss this one.
2. T+00:30 — Click the proposal row. Inline expansion (no detail page URL). Proposal description + `Inspect / Approve / Decline` buttons + `IMPACT PREDICTIONS` + `CHAT`.
3. T+01:00 — `IMPACT PREDICTIONS` shows 27 conditional markets in a flat table. Columns: `Metric / Resolution Date / Prediction`. Every row shows the *midpoint* of the range (50000, 5, 5) because no agent has traded yet. There is no baseline column, no delta column, no trade-count column. Chen cannot tell whether these values are calibrated forecasts or untouched priors.
4. T+02:00 — Call the backing API (`GET /api/proposals/:id`) out of curiosity and confirm: the server returns `baselineConsensus` alongside `consensus` for each market and `tradeCount: 0` for every one. **The data exists but the UI hides it.** The single most valuable piece of information for an approver is one JSON field away from the screen.
5. T+03:00 — Test the chat: type "What's the expected timeline for this hire to land?" and Send. Message posts and renders. Author is shown as `Zq5VAXd6x8v1a6EUQIEvNX2A2isgbmvb` (participant ID), not "Priya QA" (display name). No timestamp. No notification to the proposer (same account here, so not observable; separately verifiable).
6. T+03:30 — Inspect Approve / Decline. Plain green / red buttons. No tooltip. No subcopy saying *"Approving will credit the proposer 50 credits."* or *"Declining voids conditional markets."* Chen has no way to learn the consequences without trying.
7. T+04:00 — Click Approve. No confirmation dialog. No toast. Page does not navigate. The Approve / Decline buttons quietly disappear; the status cell on the row changes from `PENDING` to `APPROVED`. That is the sum total of visible feedback.
8. T+04:30 — Check `GET /api/agents` for the proposer: `earnedProposals` went from 0 → 50, `balance` went 986.50 → 1036.50. Payout works. But Chen has no evidence of this on any page of the app: no "decided by / at / +50 credits" trail on the proposal row, no entry in the account page's history panel, no badge on the Agents sidebar. If Chen were not the proposer, they'd have no easy way to verify the money moved.
9. T+05:00 — Refresh the page. Proposal still shown as APPROVED. Conditional markets are still open (verified via API). No UI indicator of what "approved" means for the markets themselves. Conditional markets remain listed under IMPACT PREDICTIONS even though the proposal is no longer pending.

## Friction found

- [blocker] F1 — **Approve fires without confirmation.** One click commits the decision, mints the payout, and is irreversible as far as the UI shows. Needs a `confirm()` or modal: *"Approve 'Hire senior designer' and pay the proposer 50 credits? This cannot be undone."*
- [blocker] F2 — **No baseline vs conditional vs delta display.** `GET /api/proposals/:id` already returns `baselineConsensus` per market; the IMPACT PREDICTIONS table ignores it. Fix: add two columns (Baseline / Δ) next to Prediction. Color the Δ by sign (green/red). This is the single highest-leverage change for making the approver screen actually decision-usable.
- [blocker] F3 — **No audit trail shown after approval.** No "approved by X at Y, +50 credits to Z" row on the proposal, no history log on either account or workspace settings. Chen has to grep the API to verify anything happened. Needs a visible activity section on the proposal expansion that lists proposal / trades / approval events.
- [high] F4 — **No sidebar badge on "Proposals" for pending items.** An admin with many proposals won't know something needs attention. Add a numeric badge `Proposals (1)` when the signed-in user has approval rights on any pending proposals.
- [high] F5 — **All prediction rows render identically regardless of trade volume.** 0 trades + midpoint prior looks identical to 40 trades + moved consensus. Add `tradeCount` and/or a "no trades yet" placeholder (or grey out / italicize) for zero-volume markets.
- [high] F6 — **Approver has no visible reputation for the proposer.** Chen has to decide based on a cryptic participant ID. Needs at minimum the proposer's display name, optionally calibration score / historical approval rate. (Blocker for a human approver weighing an unknown agent's proposal.)
- [high] F7 — **Chat author is participant ID, not display name.** Same root cause as persona 11 F2. Makes multi-party threads unreadable.
- [high] F8 — **Self-approval is allowed without a warning.** Priya proposed her own proposal and approved it, netting +50 credits to her own account. No warning like "You are both the proposer and approver". For solo users this is "fine in principle", but needs at minimum a tag that flags it as self-approved in the audit trail.
- [medium] F9 — **27 horizons per proposal is overwhelming on a decision screen.** Default to this-quarter + this-year and let the approver expand.
- [medium] F10 — **Conditional market state after approval unclear.** After approval, markets remain open per the vision doc — but the UI doesn't say "markets stay open for post-decision tracking" or "markets are now locked". Chen doesn't know what's happening to his stakes.
- [medium] F11 — **`Inspect` button copy is misleading.** "Click Inspect to view them in Markets" hints at navigation; actual behavior is an inline reveal on the same row. Rename to "Show predictions" / "Hide predictions" or actually route to `/markets?proposalId=X`.
- [low] F12 — **No return signal (toast / sparkle / `aria-live`) confirms the approval.** Chen didn't read the status cell and would believe nothing happened.

## What worked

- Backend is correct: `POST /api/proposals/:id/approve` flips status, pays `earnedProposals` to the proposer, and leaves conditional markets open. All plumbing verified via API.
- `GET /api/proposals/:id` returns complete market data including `baselineConsensus`, `consensus`, `rangeMin/Max`, `liquidity`, `tradeCount` — the data needed for the missing UI.
- Chat persists. Send button is disabled until text is typed.
- Conditional markets materialize correctly at proposal time (proposal proposal at 10:03:36, markets at 10:04:50 — lazy creation on Inspect, verified).

## Would they come back?

Not without F1, F2, F3 fixed. Those three together are the minimum bar for "I trust this enough to run a real decision through it". Until then, a careful approver will prefer email/Slack threads where the consequence of each click is visible.

## Recommended changes (ordered)

1. **Add a confirmation modal on Approve / Decline** with explicit consequence copy (who gets paid / voided, amount, reversibility). Always-visible subcopy on the buttons is an acceptable weaker version.
2. **Rewrite IMPACT PREDICTIONS table**: columns → Metric / Horizon / Baseline / Conditional / Δ / Trades. Group by metric; collapse horizons beyond this-year. Grey out zero-trade rows or show "no trades yet".
3. **Add an audit-trail panel on each proposal**: proposal, chat, approval/decline, payouts. Timestamped and keyed by display name.
4. **Show proposer display name and participant ID as metadata**. Optionally add a tiny calibration badge.
5. **Sidebar badge on Proposals** reflecting pending proposals assigned to / approvable by the current user.
6. **Self-approval warning** when the approver ID == proposer ID.
7. **Explain conditional-market fate on approval/decline** with copy next to the buttons: "On approve, markets stay open. On decline, stakes are refunded."

## Console / network anomalies

- `POST /api/proposals/:id/approve` returned synchronously. No errors in console.
- `earnedProposals` on the proposer changed from 0 → 50 immediately. No double-spend or race observed.
- Participant ID appears in five places that should show a display name: `Proposed by` column, chat author, Settings > participants list (not tested here), `GET /api/proposals` response, `GET /api/proposal-messages` response. A single shared display-name resolver would fix all of them.
