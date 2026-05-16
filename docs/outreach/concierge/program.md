# Pre-customer outreach phase

Status: ACTIVE since 2026-04-29. Reframed 2026-05-16: the original "founder concierge program with 2026-05-27 verdict gate" framing did not match what actually happened on the ground. The current motion is open-ended potential-customer outreach plus participant-network building plus pushing real-currency settlement live; there is no fixed verdict date.

This file supersedes the earlier "Founder concierge program" doc. The original four-week schedule, falsification thresholds, and binary verdict gate are retired. The substantive insights that still hold (selection criteria for who is worth talking to, non-negotiables when running a live call, forecaster-context strategy for any workspace that does get built) are kept below.

## Why this phase exists

Telarchy has all the infrastructure required to run real workspaces, real conditional markets, real settlements (on self-hosted) and AI participant integrations. It has zero paying customers. The risk that needs to fall first is not "do the markets calibrate" (they do) or "does the mechanism work end-to-end" (it does). The risk is whether a real operator will actually use this layer to price a real decision they were otherwise going to make on a gut call. The only way to find out is to talk to potential customers and have them either commit or articulate exactly why they will not.

Three things run concurrently in this phase, see `docs/vision.md` section "Current stage and load-bearing uncertainties" for the canonical version:

1. **Potential-customer outreach.** Direct conversations to find the first real customer.
2. **Initial AI participant network.** Workspaces have to ship with non-empty markets and forecast quality good enough that an owner reads a price and feels they are reading signal.
3. **Real-currency settlement for AI participants.** Real money turns the mechanism from advisory into economic. Infrastructure exists for self-hosted; managed turn-on is legal-gated.

## How outreach conversations are structured

The goal of any conversation is one of three things, in declining order of value:

1. A named first-customer prospect inside the buyer's network.
2. A specific, sharp reason the primary ICP hypothesis is wrong (the "biggest killer of the idea" answer).
3. A redirected segment hypothesis that the conversation makes more credible than the current ranking.

Selling Telarchy on a first call is not the goal; reality-testing the wedge is. The canonical communication patterns (what narrative to lead with, what to avoid, how to handle the term "prediction markets") live in `docs/go-to-market.md` section "Communication patterns for potential-customer outreach."

Three questions to raise on every conversation:

- Where is the first really painful entry?
- Who is the first realistic buyer?
- What is the largest unstated assumption, or the biggest killer of the idea as framed?

Per-call artifacts live in this directory. Examples:

- `helmich-2026-05-13-call-script.md` (Jirka Helmich, B2B Minds founder, ex-Mews CPO).
- `cerny-2026-05-16-preread.md` (Jan Černý, Managing Partner at Pale Fire Capital).
- `cerny-2026-05-16-input-notes.md` (raw Q&A capturing Viktor's state of thinking ahead of the Černý pre-read).

## Selection criteria for who is worth a call

When deciding whether to spend a slot on someone, score informally on these dimensions:

- **Real company:** has revenue, ships product, is not pre-product or solo-no-employees.
- **Real KPIs:** tracks at least two metrics weekly, has some dashboard or running spreadsheet.
- **Upcoming real decision (next ~30 days):** spending decision, hiring decision, product bet, anything with non-trivial stakes.
- **Warmth:** how reachable. Cold cost is high; warm intros multiply expected value.
- **Forecasting fit:** domain where AI and human forecasters could plausibly add signal.
- **AI-adjacency bonus:** company is AI-native, building AI products, or actively deploying AI agents into operations. This is the primary ICP hypothesis per `docs/go-to-market.md`.

Anti-flags: would ghost a call, regulated industry that cannot share KPIs, M&A in flight, conflict of interest, requires a multi-quarter procurement cycle.

## Non-negotiables when a call leads to a real workspace

These hold even though the broader "concierge" framing has been retired:

- **Workspace is created on the call, not after.** Operators who say "I'll set it up later" do not.
- **No mocked or seed data in real workspaces.** Real metrics, real values, or no workspace.
- **No AI-participant access without explicit operator approval.** Confidentiality is part of the value proposition; lying about it ends the relationship.
- **Position freeze on cosmetic surfaces is still active.** Landing-page rewrites, sidebar redesigns, and other taste-driven positioning iterations require a named external trigger (a specific complaint from a real operator, investor, or outreach event). The trigger goes in the commit body so the chain is auditable.

## Forecaster context strategy (still applies)

The hardest part of any real workspace is making sure the participants forecasting it actually have the context they need. Platform-operated AI participants do not know the operator's domain by default. Strategy:

- For each workspace, write a **context briefing** as a Source (text source attached to the workspace). Participants read sources via the existing source mechanism.
- Operator supplies **additional custom Sources** through the Sources tab; encouraged.
- Operator does **API connection for metric sync** (Stripe, Mixpanel, manual webhook); natural moment to pair-program the context briefing.
- The founder is effectively the **lead forecaster** on every workspace for as long as the network is small. This does not scale; it produces real forecasts.

The Claude Code skill for workspace setup is the natural force-multiplier: install the skill, get walked through KPI definition + source connection + decision elicitation in roughly ten minutes.

## Cross-references

- Vision and positioning: `docs/vision.md`, `docs/go-to-market.md`.
- ICP hypotheses and communication patterns: `docs/go-to-market.md` (sections "First-customer ICP hypotheses" and "Communication patterns for potential-customer outreach").
- Candidate pipeline and outreach status: `candidates.md`.
- Per-call working artifacts: this directory.
