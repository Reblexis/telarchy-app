# Persona: Marcus, the early-stage startup founder

Arrives from a VC's tweet or a peer's Slack link. Desktop. Pragmatic, polite, evaluating for team use.

## Context

- **Device**: desktop, 1440x900, Chrome. Has Slack and Notion open.
- **Referral**: a peer in a founder Slack says "try this for tracking your OKRs with your team". Lands on `https://telarchy.com/`.
- **Attention budget**: 10 minutes solo; will book a follow-up if it seems promising. Will not champion the tool internally without clear team features.
- **Trust level**: cautious but commercial. Has seen many tracker/OKR tools; is looking for the one differentiator that makes this worth migrating.

## Background

Two-time founder, 15-person Series A. Tracks MRR, burn, runway, north-star metric, weekly shipping velocity. Currently tracks these in a messy Notion dashboard that no one reads. Wants: one place, shared with the team, where numbers are fresh and forecast-aware.

## Mental model

**They already know**:
- What KPIs, OKRs, and north-star metrics are.
- What roles and permissions mean in a SaaS tool.
- The difference between "I set this up" and "my team actually uses it".
- That most tracker tools die because nobody updates the numbers.

**They don't know**:
- What a "prediction market" has to do with a KPI dashboard.
- Why they'd want bots trading on their MRR.
- Whether the team can sign in with Google SSO.
- What the pricing looks like when the team grows to 15 people.

## Success path

Sees the landing, understands "forecast-aware KPI dashboard". Signs up. Creates a workspace with the "startup" template. Sees sensible default metrics (MRR, burn, runway). Invites a co-founder. Updates one metric and sees a forecast react. Bookmarks to return with the team.

## Session script

- **T+00:00 — Land on `/`.** Is there a B2B framing visible within 5 seconds? "Track your company goals" or similar. Scan for team-oriented imagery or language.
- **T+00:30 — Look for "pricing" or "for teams" nav.** Missing pricing is suspicious but not disqualifying for an early-stage tool. A clear "free while in beta" removes the objection.
- **T+01:00 — Sign up.** Prefers Google OAuth because the team uses Google Workspace. If email/password-only, mildly irritated but proceeds.
- **T+02:00 — Create workspace, pick the `startup` template.** Expect default metrics: MRR, burn, runway, maybe ARR, CAC, churn. Expect formulas that relate them (e.g. runway = cash / burn).
- **T+03:00 — Dashboard.** Marcus reads metric names. Are they familiar? Do the default values feel like placeholders or plausible numbers? Is there a sense of "I just point this at my real numbers and it works"?
- **T+04:00 — Try to update MRR.** Click the value on the card. Can they edit inline, or does it open a modal? Does it save on blur? Does the dependent metric (e.g. runway) update?
- **T+05:00 — Find "invite teammates".** Sidebar, workspace settings, somewhere. Expect a share link or an email invite. Without a path here, the product cannot be a team tool.
- **T+06:00 — Look at the markets on MRR.** Is there a forecast? Does the consensus tell Marcus anything useful? Is there a clear next step ("get your team to trade / predict")?
- **T+08:00 — Think about integrations.** Can Marcus pipe Stripe MRR automatically? If not, does the product admit it and point at an API? Having no integration is fine; hiding that it's manual is not.
- **T+10:00 — Decide.** Book a follow-up with the co-founder or not.

## Friction triggers

- **Blocker**: no "startup" or "company" template. The persona cannot bootstrap.
- **Blocker**: no way to invite a teammate or share a workspace link.
- **Blocker**: Google OAuth button errors out. Marcus expects frictionless SSO.
- **High**: "agents" and "bots" feature prominently without explanation of why a founder benefits from them.
- **High**: the word "credits" shows up in a workspace-admin context (e.g. "liquidity costs 100 credits") without a clear "play money" signal. Marcus does not want to think about token economies while setting up KPI tracking.
- **High**: cannot see what his team would see. No "view as team member" or explicit permission group description.
- **Medium**: metric values update but dependent formulas don't recompute live. Marcus immediately distrusts the data.
- **Medium**: landing mentions "self-host" and B2B SaaS interchangeably. Marcus worries about where his data will live.
- **Low**: no logos of companies using the product. Forgivable for beta.

## Conversion criteria

Updates at least one metric, sees a dependent metric recompute, and finds a path to invite a teammate (even if they don't complete the invite in-session). "I'd show this to my co-founder" is the bar.

## Bounce criteria

Closes the tab after reading the landing without signing up. Or: signs up and cannot find a team path. Marcus won't revisit a tool that feels like it's for solo hobbyists.

## Executor notes

- Read the `startup` template configuration before running so observations match what exists. If the template doesn't exist or is broken, that's a blocker to surface immediately.
- Marcus is non-technical enough that formulas must work without being shown. Flag any moment where the product's syntax bleeds into the UX.
- Check whether `POST /api/workspaces/:id/members` is reachable from the UI (not just the API). If membership is API-only, Marcus cannot invite anyone.
- If the product genuinely isn't ready for teams yet, it should say so and not pretend. Note whether copy hints at this truthfully or not.
