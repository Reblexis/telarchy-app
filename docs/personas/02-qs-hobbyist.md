# Persona: Alex, the quantified-self hobbyist

Arrives from a niche subreddit link. Desktop. Curious, patient, not technical.

## Context

- **Device**: desktop, 1440x900, Firefox, broadband. Has a second monitor with Oura's dashboard open.
- **Referral**: comment on r/QuantifiedSelf saying "this could be cool for tracking habits", linking to `https://telarchy.com/`.
- **Attention budget**: 8 minutes. Would invest real time if the product clicks.
- **Trust level**: open. Uses Oura, Beeminder, Notion, Google Sheets for tracking. Has been burned by apps that promise insight and deliver dashboards.

## Background

Knowledge worker, 30s, tracks sleep, mood, weekly exercise, reading, and a personal "output" metric they made up. Not a developer. Comfortable with formulas in Google Sheets. Has never heard of prediction markets or LMSR. Skims. Would rather drag things around than type formulas.

## Mental model

**They already know**:
- How to track a metric by writing a number in a spreadsheet once a day.
- That most trackers have nice graphs and no insight layer.
- That habit apps want to lock them in with streaks.

**They don't know**:
- What a "prediction market" is or why it would help them track their habits.
- What "credits" mean. Is this real money?
- What a "workspace" is.
- What "agents" or "bots" are doing in this context.

## Success path

Signup → pick the "personal" template → see a metric that reflects a habit they recognize (sleep, exercise, etc.) → update a value once → see a forecast consensus move → understand, at a gut level, that the thing is predicting their future metric. If they reach that "oh!" moment, they might come back.

## Session script

- **T+00:00 — Land on `/`.** Read the hero. If it's framed only at companies/teams, Alex feels disqualified. If there's a line like "or track your own life", Alex keeps reading.
- **T+00:30 — Scroll the landing.** Look for an example that resembles their use case. Sleep, exercise, reading, meditation. Look for an FAQ or "how it works" section.
- **T+01:00 — Click Sign up.** Expect an easy form. Email, password, display name, consent. Fill it.
- **T+02:00 — Land on workspace creation.** Expect templates. Pick "personal" (or whichever reads like "for me, not a team").
- **T+03:00 — Dashboard.** Expect to see the metrics from the template populated. Read their names. Do they resonate? Are the values sensible, or all zero?
- **T+04:00 — Click a metric.** Can Alex update the value? Can they see the chart? Is there a "forecast" or "markets" link they understand?
- **T+05:00 — Click "Markets →" on a leaf metric.** What does this show? Is there a consensus number and a date? Do they understand that a trade would move the number?
- **T+06:00 — Look for guidance.** Is there a "how do I use this as a personal tracker?" guide anywhere? Look in the sidebar, the top bar, the footer. Follow the first obvious link.
- **T+07:00 — Decide.** Do they bookmark the site? Do they close the tab feeling "cool but weird"? Do they feel tricked (thought it was free, saw a "credits" mention)?

## Friction triggers

- **Blocker**: landing page is exclusively B2B-framed and mentions only KPIs, OKRs, company goals. Alex reads "this is for startups" and bounces.
- **Blocker**: signup demands a company name or role. Alex doesn't have one.
- **Blocker**: "create workspace" offers only startup/company templates. No personal path.
- **High**: dashboard is full of metrics named "MRR", "CAC", "Burn rate". Alex cannot see themselves in the product.
- **High**: the word "agent" appears prominently without explanation. Alex thinks of travel agents or real estate agents.
- **High**: "credits" look like money without any "play money only" reassurance. Alex wonders if they'll be charged.
- **High**: no way to edit a leaf metric value from the dashboard. Alex expected to enter "I slept 7.5h" like they would in a spreadsheet.
- **Medium**: the "Markets" drill-down leads to a page with no markets yet. Empty state is critical here; "no markets yet" should say so with an action.
- **Medium**: formula syntax is exposed to Alex when they click "Edit". They expected a GUI.
- **Low**: no mobile companion hinted at; Alex wants to check in from their phone.

## Conversion criteria

Updates at least one metric value. Acknowledges, verbally or in a bookmark, that they'd come back to see the forecasted number in a week.

## Bounce criteria

Gives up before reaching their first metric update. Or: completes signup, reads dashboard, feels the product is "for someone else".

## Executor notes

- Read `src/pages/CheckInPage.tsx` and `src/components/MetricCard.tsx` before running to know what the dashboard looks like today.
- Alex will not open `/api/help` or guides by URL. Every path they follow must be reachable by clicking.
- If the "personal" template is broken or missing, stop and report immediately — it's the load-bearing path for this persona.
- Note any moment where Alex has to decide what a domain word means ("agent", "credit", "consensus", "probability", "liquidity"). Every such moment is a friction event.
