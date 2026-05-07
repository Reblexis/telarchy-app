# Founder concierge program

Status: ACTIVE. Started 2026-04-29. Verdict gate: 2026-05-27 (4 weeks).

This is the load-bearing validation arm of the pre-launch strategy. The riskiest assumption in Telarchy is that *a real founder will paste a real decision into a workspace and let the market move them off a gut call*. This program tests it directly with a small cohort of manually-recruited founders, 30-min calls, real KPIs, real decisions, real workspaces.

## Why this exists

The product is structurally complete (LMSR markets, conditional markets, time preference, multi-workspace, real-money settlement, hooks, BetterAuth, `/marketplace`, `/guides`). Zero users today. The last 30 days of commit history is ~80% UI polish (5 sidebar redesigns, 3 landing-H1 rewrites). That pattern is the leading indicator of pre-launch procrastination: polishing surfaces for a user who hasn't been recruited yet.

A 4-week concierge program with a small focused cohort is the cheapest way to falsify the headline use case. If founders convert, the headline is locked. If they bounce on something the docs already address, that's the falsification signal, and the AI-agent-eval wedge becomes the headline instead.

## The cohort

Targets recruited in Week 0. Names in `candidates.md` (sibling file, gitignored, contains personal data). Cohort size is intentionally flexible (single-digit); enough to detect a signal, small enough that the founder can act as lead forecaster on every workspace.

Selection criteria (each scored 0-3, total /15 + bonuses):

- **Real company:** has revenue, not pre-product, not solo no-employees.
- **Real KPIs:** tracks ≥2 metrics weekly, has some kind of dashboard or running spreadsheet.
- **Upcoming real decision (~30 days):** spending decision, hiring decision, product bet, anything with ≥$10K stakes or ≥10% of one quarter's effort.
- **Warmth:** how reachable. 0=cold name, 3=texted last week.
- **Forecasting fit:** domain where AI/human forecasters could plausibly add signal.
- **Bonus +1 each:** technical (will enjoy the markets mechanic), has co-founder (richer workspace), public-facing (writes/podcasts/builds-in-public; if it works, they tell people).

Anti-flags (excludes): would ghost a call, regulated industry that can't share KPIs, M&A in flight, conflict-of-interest (e.g. SCS Software CEO planning to invest in user's other startup; different relationship, don't pitch).

## The 4-week schedule

```
WEEK 0 (this week)
  Day 1   - Recruit. Outreach funnel: build a list, ask a subset, target a small handful of booked calls.
  Day 1+  - LinkedIn export submitted (ZIP arrives in ~24h, unlocks broader filtering).
  Mid-wk  - Confidentiality checklist drafted. /cso pass focused on confidentiality.
  Mid-wk  - Concierge operating model written: intake form + call script + weekly memo template.
  Mid-wk  - Tracking sheet + falsification thresholds locked.
  End-wk  - Persona 4 (Marcus, founder) smoke test. Fix anything blocker/high.
  End-wk  - Min-viable launch backlog: pricing one-liner, signup display name, /guides discoverability, 504→404 verified.
  End-wk  - Doc rewrites (public-facing only): soften open-core language in vision.md and landing.

WEEK 1
  - First concierge calls running. 30 min each. Hand-feed forecaster context per workspace as Sources.
  - /leaderboard built and linked from the sidebar (decision 2026-05-01: ship the nav link with the page rather than gating it on the Week-4 verdict, so concierge calls and persona-10 traffic both land on the ranking).
  - agent-eval template + register-your-agent doc.

WEEK 2-3
  - Calls iterating. POSITION FREEZE ACTIVE: no landing/positioning/sidebar work without a named external trigger.
  - Weekly decision memos sent to each founder.
  - Watch Week-2 forecast-utility signal (codex flag): if founders say "the forecast didn't tell me anything I didn't already know," that's higher-priority signal than retention numbers.

WEEK 4 (verdict gate, 2026-05-27)
  - Binding go/pivot decision based on locked falsification criteria.
  - Public CP1 launch announcement (the /leaderboard nav link itself shipped on 2026-05-01).
  - Email lifecycle ships (Resend or Postmark). Broader launch sequence begins.

POST-VERDICT
  - Decide on CP4 (spectacle markets), open-source revisit, broader launch.
  - Build Claude Code skill for founder workspace setup (`/setup-telarchy-workspace`).
```

## Falsification criteria (LOCKED 2026-05-07; binding for 2026-05-27 verdict)

The verdict on 2026-05-27 is decided by these criteria, agreed in advance to prevent goalpost drift. Two behavioral signals, both observable without asking the founder leading questions, both pattern-over-anecdote.

**CONFIRMED (founder governance is the headline; ship the broader launch):**
EITHER of these:
- ≥2 cohort founders bring a 2nd real decision unprompted by Week 4 (a new proposal or a new market they create themselves, not because we asked them to), OR
- ≥1 cohort founder makes an unprompted referral by Week 4 (sends another founder to telarchy.com or asks for an intro template, without us asking).

**FALSIFIED (pivot to AI-agent-eval per `AGENTS.md` § Canonical positioning):**
BOTH of these:
- 0 cohort founders bring a 2nd unprompted decision, AND
- 0 cohort founders make an unprompted referral, AND
- Majority of cohort is cold past Week 2 (no metric updates, no new markets, no proposals; not just quiet but actively disengaged).

**INCONCLUSIVE (anything between confirmed and falsified): default to pivot.** Founder governance becomes a supporting use case; AI-agent-eval is promoted to headline. The default-to-pivot is intentional: extending the program in the gray zone is goalpost drift. We can always come back to founder governance from an AI-agent-eval headline; we cannot un-spend the next quarter chasing a weak founder signal.

### Why these two and not the other three

The original Codex review proposed five candidate criteria. Three are deliberately not locked:

- **Asked to invite another participant.** Confounded by the founder's team structure (a solo founder can't invite a co-founder); it measures the founder's situation, not Telarchy's value.
- **Trusted forecast enough to delay/change/spend.** Requires founder self-report; verbal commitment is noisier than observable behavior. The 2nd unprompted decision criterion already captures behavioral trust, more cleanly.
- **Would pay post-verdict.** Verbal commitment under social pressure of a 1:1 call. Revealed preference (do they actually keep using it for new decisions) is the stronger signal and is already covered by the 2nd unprompted decision criterion.

### What gets tracked, where

- `docs/outreach/concierge/tracking.md` (gitignored, contains real founder names) is the live operational dashboard with the founder × stage matrix and the locked thresholds restated. Update after every concierge call.
- The two criteria here MUST NOT BE EDITED before 2026-05-27. If you find yourself wanting to soften them mid-program, that is the goalpost drift the lock was designed to prevent. Add the would-have-been observation to the post-verdict notes file instead.

## Operating model artifacts (Week 0 P1)

Three artifacts to write before first call. All live in this directory (`docs/outreach/concierge/`).

1. **Intake form template** (`intake-form.md`, sibling)
   - Founder name, company, role
   - Top 3-5 KPIs / metrics they care about
   - Current values + units
   - Time horizon for each metric
   - Decision being considered (one specific upcoming call)
   - Constraints on the decision (budget, deadline, alternatives)
   - Private context the AI participants need to forecast
   - Co-founders / collaborators to include in workspace
   - Confidentiality requirements (which fields are export-OK, which are private-only)

2. **Call script** (`call-script.md`, sibling)
   - 5 min: intro + Telarchy 90-second pitch
   - 10 min: decision elicitation (use intake form as guide)
   - 10 min: live workspace setup, workspace created on the call, NOT promised for later
   - 5 min: next-step commitment (you'll send the first decision memo Friday; they'll update one metric by Monday)

3. **Weekly decision memo template** (`weekly-memo.md`, sibling)
   - Founder name + week
   - Market view: current consensus per metric
   - Points of disagreement among forecasters (where the bots/humans diverged)
   - Confidence interval
   - Recommended action
   - What would change the forecast
   - Attached evidence: per-market chart + trades

## Forecaster context strategy

Codex's sharpest critique: with private founder workspaces and platform bots that don't know the founder's domain, market forecasts may be decorative not informative. Mitigation strategy: **Hybrid Approach A**.

- For each founder workspace, write a **context briefing** as a Source (text source attached to the workspace). Bots read sources via the existing source mechanism.
- Founder can supply **additional custom Sources** via the Sources tab; encouraged.
- Founder also does **API connection for metric sync** (Stripe, Mixpanel, manual webhook); natural moment to pair-program a context briefing.
- You are effectively the **lead forecaster** on every concierge workspace for the first 4 weeks. This works for a small cohort; doesn't scale; produces real forecasts.

The Claude Code skill for workspace setup (P2 TODO) is the natural force-multiplier: install the skill, get walked through KPI definition + source connection + decision elicitation in 10 minutes.

## Non-negotiables

- **Position freeze** is in effect for 4 weeks (until 2026-05-27). No landing-page rewrites, no sidebar redesigns, no positioning iterations. If you find yourself opening `LandingPage.tsx`, close it. The only acceptable change to public copy during this window is in response to a *specific complaint from a real concierge founder*.
- **Workspace is created on the call, not after.** Founders who say "I'll set it up later" don't.
- **No mocked or seed data in concierge workspaces.** Real metrics, real values, or no workspace.
- **No AI-participant access without explicit founder approval.** Confidentiality is part of the pitch; lying about it kills the program.
- **Verdict at end of Week 4 is binding.** Whatever the falsification criteria say, you write a one-page verdict and live with it for the next quarter.

## Cross-references

- CEO plan with full review history: `~/.gstack/projects/Reblexis-metrics-tracker/ceo-plans/2026-04-29-pre-launch-strategy.md`
- TODOs (P1 Week-0 items, P1 Week-1 items, P2 deferred): `TODOS.md`
- Persona 4 (Marcus, the founder this program targets): `docs/personas/04-startup-founder.md`
- MVP launch backlog (now partially superseded; email lifecycle deferred to post-verdict, GitHub link replaced by /guides discoverability): `docs/mvp-launch-backlog.md`
- Vision and positioning: `docs/vision.md`, `docs/go-to-market.md`
- Outside voice (codex) findings: section "Outside Voice (Codex), applied revisions" in the CEO plan.
