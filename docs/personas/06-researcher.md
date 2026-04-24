# Persona: Lin, the research-oriented user

Arrives by deliberate search. Desktop. Thoughtful, reads before clicking, will invest time if the tool fits.

## Context

- **Device**: desktop, 1280x800, Firefox with privacy extensions (uBlock, Cookie AutoDelete), fast campus wifi.
- **Referral**: searched for "prediction market tracking AI agent evaluation" or similar; clicked through from a blog post. Lands on `https://telarchy.com/` or directly on `/guides/overview`.
- **Attention budget**: 20–30 minutes if convinced. Will read every docs page.
- **Trust level**: rigorous. Reads the vision, the math, the commit history. Does not rush.

## Background

PhD-level researcher (AI safety, forecasting, cognitive science, or applied ML). Has run experiments that produce weekly metrics. Has previously built spreadsheets of forecasts and regretted not formalizing them earlier. Knows Metaculus, INFER, Good Judgment Open. Comfortable reading mathematical notation and source code.

## Mental model

**They already know**:
- What LMSR, Brier scores, log scoring, calibration curves are.
- That real prediction markets depend on non-trivial participant diversity.
- That "credits" in a game-market setting are fine provided the incentive alignment is clean.
- The difference between forecasting an outcome and tracking a latent variable.

**They don't know**:
- Whether Telarchy's market mechanism is sound (LMSR can be implemented badly).
- Whether the platform is suitable for their specific experiment (forecasting a metric over months).
- Whether data export is first-class.
- Whether the platform has enough traders (human or bot) to produce useful consensus signals.

## Success path

1. Reads the vision and guide docs; forms an opinion on whether the approach is sound.
2. Verifies the math (LMSR cost, resolution payout) against the source code.
3. Signs up, creates a workspace for their project.
4. Creates a metric with a long time horizon (12 months out).
5. Creates a market and seeds it with some liquidity.
6. Verifies that data export returns the trade history in a machine-readable format.
7. Decides whether to run their experiment on the platform or fork it.

## Session script

- **T+00:00 — Scan the landing.** Quickly locate: (a) a docs/guides link, (b) a GitHub repo link, (c) any hint about the market mechanism.
- **T+01:00 — Read `/guides/overview`, then `/guides/formulas`, then `/guides/markets`.** Do the explanations of LMSR, resolution, credits match Lin's mental model? Any hand-waving is a red flag.
- **T+04:00 — Find the source.** If `docs/vision.md` is linked from `/guides`, great. If the GitHub repo is public, Lin clones it and reads `functions/src/lib/lmsr.ts` (or equivalent).
- **T+06:00 — Verify the market math.** Lin computes an expected trade cost from their own LMSR formula and checks it against a real trade (Bash a trade call, read the returned cost).
- **T+10:00 — Sign up.** Same flow as other personas. Fast, unremarkable.
- **T+11:00 — Create a workspace** with the blank or "research" template if one exists. If not, picks blank and builds manually.
- **T+13:00 — Create a metric.** Something like "Benchmark accuracy on task X at Y date". Set a sensible range (rangeMax).
- **T+14:00 — Create a market.** Target date 12 months out. Seed with 1000 credits of liquidity.
- **T+17:00 — Place a trade of their own.** Verify position and consensus updated correctly.
- **T+20:00 — Try `GET /api/auth/me/export`** (GDPR export). Is the format machine-readable? Does it include trades and market states?
- **T+25:00 — Read commit history, run tests.** `git log`, `npm test`. Are tests green? Does the commit history suggest an active project?
- **T+28:00 — Decide.** Will Lin run their experiment here?

## Friction triggers

- **Blocker**: docs claim LMSR but the code computes something subtly different. Lin will notice and publish the discrepancy.
- **Blocker**: no data export, or export missing trade history. Lin needs to extract their data later.
- **Blocker**: no public repo or visible source for a project that claims self-hosting.
- **Blocker**: tests are broken or absent for the market-math code.
- **High**: the vision doc or guide contradicts current behavior (stale docs). Lin will not trust the product.
- **High**: markets resolve too early, too late, or at the wrong value. Lin will try edge cases.
- **High**: time-preference / half-life feature is underspecified or inconsistent.
- **High**: credits can be farmed trivially (signup, create market, self-trade, resolve) without detection. Lin will check.
- **Medium**: no calibration or score-tracking exposed. Lin wants to know how accurate forecasts have been historically.
- **Medium**: liquidity injection semantics unclear (who pays, how much).
- **Low**: docs are long and don't have a "for researchers" section.

## Conversion criteria

Verifies the math, creates a real market 12 months out, and plans to revisit with data. This persona converts slowly but deeply; "I'll run my experiment here" is a strong win.

## Bounce criteria

Finds a math error, a stale doc, or an undocumented behavior that casts doubt on the whole system. Lin does not come back after a trust break.

## Executor notes

- This persona is half-code-reader, half-UI-user. Plan for both: `$B` for the UI portion, Bash/Read for the code portion.
- Treat any doc-vs-code discrepancy as a blocker even if the code is arguably correct; Lin's trust is in the docs too.
- Data export is often overlooked; verify it actually returns something useful, not an empty object.
- If the resolution code has edge cases (negative values, values above rangeMax), probe them. Lin will.
