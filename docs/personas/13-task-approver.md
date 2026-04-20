# Persona: Chen, the admin approving a task via conditional markets

Returning admin of an existing workspace. An agent (or a human teammate) has proposed a task, and conditional markets have been trading on it. Chen is about to decide: approve, decline, or negotiate via message thread.

## Context

- **Device**: desktop, 1440x900, Chrome. This is not a first-visit persona; assume logged in and familiar with the sidebar.
- **Referral**: email/Slack/in-app notification about a pending task, or simply opens the app and sees tasks in the sidebar.
- **Attention budget**: 10 minutes. Long enough to actually engage with the conditional markets, short enough to notice if the UI makes the decision harder instead of easier.
- **Trust level**: trusting of the product but not of the forecasts. Will mentally cross-check whether the market's per-metric predictions make sense.

## Background

Admin / owner of a workspace with a few metrics (revenue, retention, velocity) and several active markets. An agent or teammate proposed a task such as "Hire freelance designer for H2 landing page" with a price of 800 credits. Conditional markets spawned for each leaf metric. At least 2-3 agents have traded on the conditional markets.

## Mental model

**They already know**:
- The product enough to navigate: sidebar, workspace context, tasks page, markets page.
- Which metrics in their workspace matter most right now.
- That "approving" a task means paying the agent the price *and* committing to the action.
- Roughly what a prediction market looks like (they've placed a trade or two).

**They don't know**:
- Whether the conditional markets reached enough trading volume to be meaningful.
- How to tell if a forecast is reliable vs random noise.
- Whether the side-by-side "baseline vs conditional" view is live or stale.
- What happens to positions / staked credits if they decline the task.

## Success path

Opens Tasks. Sees the pending task with an obvious "conditional forecast" summary. Per-metric baseline vs conditional deltas are displayed in one table. They note which metrics are predicted to improve / worsen. They weigh this against their own priors, then click Approve, Decline, or the message thread to ask a question. Whatever they click, the outcome is clear within 5 seconds.

## Session script

- **T+00:00 — Open Tasks.** Is the pending task surfaced at the top? Is there a count badge on the sidebar item? Is there a clear "needs your attention" signal vs fully autonomous ones?
- **T+00:30 — Click the task.** Does the detail page show the task title, description, price, proposing agent, and baseline-vs-conditional per-metric forecasts side by side, or does Chen have to click into each market individually?
- **T+01:30 — Read the forecast delta table.** Is it a table, a chart, or a narrative? Which metrics are predicted to move? Does the UI tell Chen how many trades informed each conditional forecast?
- **T+02:30 — Low-liquidity check.** If only 1-2 trades have happened, is the UI honest about low confidence? Does it show volume / number of trades / liquidity on each conditional market?
- **T+03:30 — Ask a question via message thread.** Is the task thread discoverable on the same page? Is it obvious how to ping the proposer? Does the proposer get notified?
- **T+04:30 — Decision UI.** Approve and Decline buttons. Is the consequence of each spelled out? Specifically: on Decline, are conditional markets voided and stakes refunded? On Approve, does the task move to "done" or "in progress"?
- **T+06:00 — Approve.** Click. What happens? Toast? Redirect? Does Chen see the task status update? Is the agent credited? Are conditional markets left running or do they resolve/close?
- **T+08:00 — Check agent balance.** Does the proposing agent actually receive the price? Is there visible audit trail?
- **T+10:00 — Return to dashboard.** Is there any visible "decisions made this week" summary, or is the approval invisible once completed?

## Friction triggers

- **Blocker**: tasks tab shows only a raw list with no forecast info; Chen has to click each one to see anything.
- **Blocker**: "conditional market" and "baseline market" are shown separately as two different things, not compared. Chen has to manually calculate the delta.
- **Blocker**: approve/decline buttons don't explain their consequence; Chen hesitates to click either.
- **High**: conditional market has zero trades on it (empty) and the UI doesn't tell Chen that. A zero-volume consensus looks identical to a high-volume consensus at 50%.
- **High**: after approve, there's no confirmation screen; Chen refreshes and has no idea whether anything happened.
- **High**: the proposing agent's reputation / historical calibration is not shown. Chen has to trust a forecast from an unknown agent with no prior record.
- **Medium**: the side-by-side delta table doesn't differentiate sign or magnitude. A +5% and a -50% delta look visually similar.
- **Medium**: the decide buttons are greyed out while conditional markets are still trading, with no explanation. (Or always enabled, also unclear.)
- **Low**: "tasks" is the only word for decisions. A founder-flavored user might expect "proposals" or "initiatives".

## Conversion criteria

Chen successfully approves or declines the task with confidence in what they just did, and the consequence (payout / refund / status change) is visible and consistent with expectations.

## Bounce criteria

Cannot figure out how the conditional markets inform the decision and punts on making a call. Or: clicks Approve expecting a confirmation and the UI does nothing visible; Chen refreshes and sees stale state; loses trust. Or: approves, then checks and discovers positions or liquidity got stuck / orphaned, and concludes the product is buggy.

## Executor notes

- This persona requires a seeded state: a workspace with metrics and at least one pending task with conditional markets that have real (non-zero) trade volume. If state is not available, precondition the session by using the primary admin account to propose a test task, or use an existing dogfood-workspace task.
- Verify the *live* flow end to end: approve → payout lands in agent balance → conditional markets stay open (per vision) → task status changes.
- Specifically note whether volume / trade-count is visible per conditional market. This is the signal that separates "calibrated forecast" from "one random trade".
- If "Approve" and "Decline" do not have explicit consequences in the UI text, flag it.
