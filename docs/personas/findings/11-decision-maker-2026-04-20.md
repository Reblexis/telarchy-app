# Persona findings: Priya, the decision-maker

Date: 2026-04-20. Executor: Claude. Budget: 8 min. Used: ~6 min (bounce).

## Outcome

Bounce. Priya proposes her hire decision as a task, sees an "Impact Predictions" table with 27 rows of midpoint values and no way to tell what's baseline vs what's the forecast for her decision. Cannot answer the question she came to answer ("does hiring help my metrics more than the freelancers?"). Closes tab. The landing promise "Better decisions, faster" does not survive contact with the product journey today.

## Session log

1. T+00:00 — Land on `/`. New hero copy is deployed: "Prediction markets for company decisions. Better decisions, faster." Footer animation says "0 markets active · 0 AI agents forecasting · 0 predictions this week". The marketplace has 45+ live markets. Priya's trust is nicked.
2. T+00:30 — Click `/marketplace`. Flat list of metric markets (Customer satisfaction 5.00, Weekly revenue, etc.) across a handful of public workspaces. Zero tasks / decisions shown pre-signup. The landing promise is about decisions; the marketplace is a metric catalog. Gap.
3. T+01:00 — Click "Get started". Signup form. Consent gate present. Email + display name + password. Submit.
4. T+01:30 — Post-signup lands on `/create-workspace` ("What do you want to improve?"). No option matches "help me decide something". She picks "My startup" because it's the closest of the three.
5. T+02:00 — "Name your workspace", pre-filled weekly revenue target field. She names it, clicks through. Lands on `/check-in?welcome=1`: "Set your starting point." 3 metrics (CSAT, Product quality, Weekly revenue) with sliders. Enters real-looking starting values.
6. T+02:30 — Metrics page shows "Now" and "Outlook" for each metric. "Outlook: 5.20 / 5.10 / 46200" are displayed *seconds* after she saved "Now: 7 / 6 / 12000". The page also said "Bots arrive in about 5 minutes" on the previous step. Where do these forward predictions come from? Not explained.
7. T+03:00 — Navigate to Tasks. Propose form at the top: Title / Description / Price ($). Placeholder is "Improve sleep routine" (a "My life" example, in a "My startup" workspace). She fills out her hire decision and submits.
8. T+03:30 — Task appears in a table. Columns: Title / Proposed by / Price ($) / Status. `Proposed by` shows a cryptic participant ID `Zq5VAXd6x8v1a6EUQIEvNX2A2isgbmvb`, not "Priya QA". Priya's first thought: "Who's that? Did someone else propose this?" Trust break.
9. T+04:00 — Click the task row. Inline expansion (not a detail page) shows description, `Inspect` / `Approve` / `Decline` buttons, `IMPACT PREDICTIONS` section saying *"No impact predictions yet. Click 'Inspect' to view them in Markets."* plus a Chat section. Priya clicks Inspect.
10. T+04:30 — Inspect changes its label to "Exit Inspect" and the IMPACT PREDICTIONS table populates with 27 rows. Columns: Metric / Resolution Date / Prediction. Prediction values are all identical midpoints (50000, 5, 5) across all 27 target dates stretching from next week (2026-W20) to 2039. No baseline-vs-conditional comparison. No delta column. No trade count or liquidity indicator. No "prediction moved from X to Y" signal.
11. T+05:00 — She stares at 27 rows of "50000" with target dates 3 months to 13 years out and realizes she cannot tell (a) what these numbers would be *without* the task, (b) whether any real forecasting has happened yet, or (c) which target dates are the ones she should care about. The "market-calibrated forecast of impact" from the landing page is nowhere on screen.
12. T+05:30 — Hovers Approve. Button is green, no tooltip, no confirmation explanation. Doesn't click — she doesn't know what will happen to her $50 (which is actually 50 credits, but the UI says "$50.00").
13. T+06:00 — Gives up and closes the tab. Final mental model: "Cool idea, but I can't use it to make this decision."

## Friction found

- [blocker] F1 — **No baseline-vs-conditional comparison on the task detail.** The `IMPACT PREDICTIONS` table shows only the conditional market's current midpoint. For the core futarchy loop to work, Priya needs to see "baseline X → conditional Y (Δ)" for each relevant metric/horizon. Today she sees a column of identical midpoints that look like noise. Owner: task detail UI. File: the task expansion row in `src/pages/TasksPage.tsx` (the block that renders IMPACT PREDICTIONS).
- [blocker] F2 — **`Proposed by` column shows an opaque participant/API-key ID instead of the proposer's display name.** Priya sees `Zq5VAXd6x8v1a6EUQIEvNX2A2isgbmvb` for a task she personally just filed. Socially confusing and makes audit trail unreadable. Needs to map participantId → `displayName` (or `email` fallback) at render time.
- [blocker] F3 — **Zero-volume conditional markets render identically to high-volume ones.** All 27 rows show `50000` or `5` (the midpoint) with no "trades: 0" or liquidity marker. A calibrated forecast with 40 trades would look the same on this screen as an empty market. Add `tradeCount` and `totalStake` columns, or a visual "no signal yet" badge when `tradeCount === 0`.
- [high] F4 — **Task target-date explosion: 27 conditional markets for a single hire decision, stretching to 2039.** For a "hire a designer" choice, markets resolving in 13 years are noise. Default horizons should be bounded (e.g. next month + next quarter + next year), with longer tails opt-in.
- [high] F5 — **Approve / Decline buttons have no consequence copy.** Plain green "Approve" with no tooltip, no modal, no "this will charge you 50 credits and commit". Priya refuses to click either. Re: persona 13 friction triggers — same issue from the approver's side.
- [high] F6 — **Post-signup routes directly to `/create-workspace`, skipping the `/start` fork page.** A user with a decision has no visible path to "forecast on an existing workspace" or "just look around". The only option is creator-flavored.
- [high] F7 — **"What do you want to improve?" template mismatch.** Options are "My startup / My life / or start from scratch". Priya's mental model is "I have a decision to make". The product's value prop per the landing page is *decisions*; the onboarding is *building a dashboard*. The pitch and the journey disagree.
- [high] F8 — **Landing footer stats display 0 / 0 / 0** ("0 markets active, 0 AI agents forecasting, 0 predictions this week") despite 45+ live markets visible on `/marketplace`. Either the counter query is broken or the UI is pinned. Trust break on first surface.
- [high] F9 — **Browser tab title is stale: "Telarchy: AI forecasts on your goals".** The hero now says "Better decisions, faster." Every tab, bookmark, and social share preview still shows the old pitch. Needs `document.title` refresh in the root layout and OG tags in the HTML shell.
- [high] F10 — **"Outlook" values appear instantly on the metrics page with zero trades and no bot presence.** Right after saying "Bots arrive in about 5 minutes", the UI shows `Outlook: 5.20 / 5.10 / 46200` for a workspace that is 30 seconds old. Either hardcoded seed or bootstrap-computed; either way Priya reads it as fake signal.
- [medium] F11 — **Currency label mismatch: price input labeled "Price ($)" and the cell shows "$50.00" though USDC is disabled and units are credits.** Consistent with persona 10 F1. Should say "Credits" (or "$50 credits") on this instance.
- [medium] F12 — **"Inspect" button semantics unclear.** Copy on the Impact Predictions block says *"Click 'Inspect' to view them in Markets."* Clicking Inspect does not navigate to the Markets page; it just populates the predictions inline on the task row and changes the label to "Exit Inspect". The copy is misleading.
- [medium] F13 — **Task form placeholder "Improve sleep routine" appears in a "My startup" workspace.** Placeholder needs to reflect the template the user picked.
- [medium] F14 — **No "how many agents have traded on this" signal on the task detail.** Priya cannot tell whether 0 agents, 1 agent, or 30 agents have contributed. Same-shaped issue as F3 but even at the task level.
- [low] F15 — **Clicking the task row expands inline with no scroll-into-view.** The `<tr>` uses `cursor: pointer` and an onclick handler but no URL change, no aria-expanded, no keyboard affordance. Screen-reader and keyboard users cannot discover the detail.

## What worked

- Signup + consent + workspace creation took ~90 seconds, no dead ends.
- Task proposal API works end-to-end: POST → 27 conditional markets spawned on `Inspect`, confirmed via `GET /api/predictions/markets?taskId=...`. Plumbing is correct; the UI just hides the result.
- `/api/tasks` with `X-Workspace-Id` returns the expected structure.
- Consent gate is in place and blocks submit until checked. Links to /terms and /privacy work.

## Would they come back?

Unlikely without changes. Priya's core need, "tell me the predicted impact of my decision on my goals", is answerable by the data (the conditional markets exist and would move once bots traded), but the UI today does not surface baseline-vs-conditional deltas. She would remember the pitch as "sounded right but I couldn't use it". If F1 + F3 + F5 + F10 ship, she'd be willing to retry.

## Recommended changes (ordered by persona-blocking impact)

1. **Show baseline-vs-conditional for each metric/horizon on the task detail.** Table columns: Metric / Horizon / Baseline / Conditional / Δ / Volume. Collapse horizons beyond "this year" unless the user expands. This is the single highest-leverage UI change for the futarchy loop.
2. **Display proposer display name, not participant ID**, on the tasks list and detail.
3. **Add trade-count / liquidity indicator on every prediction** (`"no trades yet — forecasts arriving"` vs `"12 trades · 34 credits liquidity"`). Zero-volume markets must look visually distinct from traded ones.
4. **Explicit consequence copy on Approve / Decline.** A confirmation modal or always-visible subcopy: *"Approving will charge 50 credits to <you> and mark the task Done."* / *"Declining voids conditional markets and refunds stakes."*
5. **Route post-signup to `/start`** so users with decisions (or just curious) get a fork, not a create-workspace funnel.
6. **Fix the landing stats counter** (show real live numbers or remove the ticker) and **update `<title>` + OG tags** to match the new pitch.
7. **Cap default conditional-market horizon** at next quarter + next year; longer tails are opt-in.
8. **Hide the "Outlook" column or annotate it clearly** ("Forecast once agents arrive") until at least one trade exists on the relevant baseline market.

## Console / network anomalies

- None observed in this session. Signup and task proposal returned expected 2xx codes.
- `POST /api/tasks` creates the task synchronously; conditional markets materialize after `Inspect` (market generation appears to be lazy on first inspect, confirmed by `createdAt` on the conditional markets being ~1 min after the task). Worth verifying whether eager creation at task-submit time is more intuitive.
