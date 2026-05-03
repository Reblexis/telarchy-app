# Persona: Priya, the manager with a decision to make

Arrives via a peer's tweet about "prediction markets for company decisions". Desktop. Has a specific, concrete decision weighing on her. Evaluating whether this tool makes that decision easier *today*, not whether it's interesting in theory.

## Context

- **Device**: desktop, 1440x900, Chrome. Slack and a Google Doc full of pros/cons notes open.
- **Referral**: a product-manager friend DM'd her the landing URL after seeing the "Better decisions, faster" hero copy. Lands on `https://telarchy.com/`.
- **Attention budget**: 8 minutes. She's between meetings and wants to know if it's worth booking time to try it properly.
- **Trust level**: curious but pragmatic. Has heard of prediction markets (vaguely Polymarket, vaguely Manifold) but never used one. Does not want a research tool; wants a decision tool.

## Background

VP Product at a 30-person post-seed startup. This week she's deciding whether to (a) hire a senior designer full-time, or (b) contract two freelance designers for the same total cost. She's been flip-flopping for two weeks. Team opinions are split. She wants a sharper way to decide than "another meeting".

## Mental model

**They already know**:
- What a prediction market is (a betting pool whose prices reflect crowd belief).
- What a KPI is and what their company's top-line metrics are (ARR, DAU, NPS).
- That "conditional" anything in economics means "if X, then what about Y".
- That they don't have time to read docs before knowing whether this is for them.

**They don't know**:
- What a "workspace" is.
- What "agents" are doing on the platform or why she'd care.
- What "credits" are or whether they cost money.
- Whether the product can actually answer her specific question or whether she has to build scaffolding first.

## Success path

Lands on `/`. Hero tells her the product turns decisions into forecasts. Sees a demo, a live example, or a worked scenario that roughly matches her own decision. Signs up. Follows an onboarding that gets her from "I have two options" to "I have a conditional forecast for each" in under 5 minutes. Bookmarks the URL.

## Session script

- **T+00:00 — Land on `/`.** Read the hero. Does "Better decisions, faster" ring true or feel like generic SaaS copy? Does the sub-copy explain *how*? Does the landing show a worked example of a real decision getting forecasted, or only abstract "AI agents trade" illustrations?
- **T+00:30 — Scroll the landing.** Look for "how does this help me decide X vs Y" framing. Not metrics abstractly, but a decision example. Are there testimonials or any social proof of real decisions made?
- **T+01:00 — Marketplace (anonymous).** Does `/marketplace` show any *decisions* in progress (conditional markets tied to proposals), or only flat metric forecasts? A visitor looking for a decision-support tool should see decisions, not just metric tickers.
- **T+02:00 — Sign up.** Google OAuth preferred. Does the consent gate make sense? Does it take more than 20 seconds?
- **T+02:30 — Post-signup.** Where does she land? If `/start`, which option makes sense for "I have a decision"? "Make better decisions" is the obvious pick, but will it lead to the decision-framing flow, or just a workspace-creation form?
- **T+03:30 — Create a workspace.** Pick a template that resembles her use case. Does a template mention "decisions" explicitly, or only "metrics"? Is there an "add a decision to evaluate" CTA anywhere?
- **T+04:30 — Propose her decision as a proposal.** Is there a clear "propose an action" or "evaluate an option" button? Does it ask for the right inputs (title, description) without enforcing fields whose meaning is undefined for an internal decision?
- **T+05:30 — See conditional market output.** If she proposed two proposals (hire senior vs contract freelancers), can she view side-by-side expected deltas on her metrics? If she proposed only one, does the output help her decide?
- **T+06:30 — Realism check.** Are there agents actually trading on her proposal? Or is the market empty because no agents know about her brand-new workspace? If empty, what's the UI message?
- **T+08:00 — Decide.** Bookmark and return with more time, or close tab.

## Friction triggers

- **Blocker**: landing pitch promises decisions but the product only shows metric forecasts. The word "decision" does not appear prominently anywhere in the signed-in UX.
- **Blocker**: cannot create a proposal from a fresh workspace without first setting up metrics (metric prerequisite is hidden and frustrating).
- ~~**Blocker**: proposals require a "price" field whose meaning is undefined for an internal decision.~~ (Resolved 2026-05-01: the price field was removed from proposal proposal because its meaning was undefined for internal decisions.)
- **High**: conditional market output is not visually side-by-side for the two options she cares about. She has to hold "hire senior's forecast" in her head while clicking around for "contract freelancers' forecast".
- **High**: new workspace has zero trading activity, so the conditional markets she creates will have zero consensus and zero agent forecasts. The UI does not acknowledge this. Priya reads it as "broken".
- **High**: onboarding forces a walk through metrics-first, which is generic dashboard work. Her specific decision gets no priority or shortcut.
- **Medium**: "agents" are pitched as trading bots for metrics, but Priya has no agents and nothing in the UI explains how to get them on her workspace.
- **Medium**: credits, liquidity, LMSR math, or "consensus" appear in the UI without explanation.
- **Low**: "workspace" jargon — she'd prefer "team" or "org" or "project".

## Conversion criteria

Ends the session having proposed at least one of her two options as a proposal, and having seen *some* kind of forecasted output (even placeholder or empty-state) tied to her decision. Says "I'd come back with my actual numbers."

## Bounce criteria

Closes the tab without signing up after reading the landing and seeing nothing that matches her concrete decision-making need. Or: signs up and cannot find a "decision" concept anywhere in the signed-in UX within 5 minutes. Or: proposes a proposal, gets a blank market with no consensus, reads it as "broken", leaves.

## Executor notes

- Priya is the archetype for the post-2026-04-20 landing copy. If this persona bounces, the new hero is writing checks the product can't cash.
- A real test of this persona should try to do exactly what the landing pitch promises: turn a decision into a forecast. Note every step where that path is unclear.
- If conditional markets are creatable only through a specific UX path that's buried, that's a finding.
- The "empty market" problem is crucial. A new user's conditional market will have zero liquidity until agents or other users trade. Note exactly what UI is shown and whether the product addresses the cold-start for conditional markets.
