# TODOS

Project backlog, prioritized. P1 = blocking the next milestone (founder concierge), P2 = important but not blocking, P3 = nice-to-have.


---

## P1 — Week 0 (this week, before founder concierge starts)

### Run /cso security pass — focused on confidentiality, not open-source
- **What:** Run the `/cso` skill in daily mode against the live product. **Reframed (codex 2026-04-29):** the question is NOT "is the code safe to open-source." It is "can a founder safely paste confidential KPIs into this hosted system with AI participants?" Triage gaps in that order: workspace isolation, AI-participant data access, master API key handling, admin audit trail, secrets management.
- **Why:** Concierge users are real, named founders with real network value. The confidentiality checklist (separate TODO above) needs honest answers, and `/cso` will surface where current answers are wrong.
- **Pros:** ~1-2 CC-hours yields a short triage list. Most fixes are likely small.
- **Cons:** May surface a larger issue that delays Week 1.
- **Context:** Codex outside-voice reframed the original /cso framing. The skill is still useful, but its output goes into the founder-call confidentiality checklist, not the open-source-readiness gate.
- **Effort:** S (CC).
- **Depends on:** Nothing.

### Recruit founder cohort — DAY 1 (was Week 1, codex moved it earlier)
- **What:** Build a list of candidate founders today, reach out to a subset for 30-min calls. Target a small cohort booked by end of Week 0.
- **Why:** Codex flagged this as the top sequencing fix: everything else gates on whether these people exist. If you can't list 20 names today, the wedge is wrong before any code is written.
- **Pros:** Falsifies the founder-network assumption immediately. If recruitment fails, you know within 48h, not 4 weeks.
- **Cons:** Founder time. Cold DMs are uncomfortable.
- **Context:** Codex outside-voice review of CEO plan, 2026-04-29. Original plan had recruitment in Week 1; codex correctly moved it to Day 1.
- **Effort:** Founder time, 1-2 days.
- **Depends on:** Nothing.

### Concierge operating model (intake form + call script + memo template)
- **What:** Three artifacts. (1) Intake form: founder name, top KPIs/metrics, current values, time horizon, decision being considered, constraints, private context. (2) Call script: 30-min outline (5 min intro, 10 min decision elicitation, 10 min live workspace setup, 5 min next-step commitment). (3) Weekly decision-memo template: market view, points of disagreement among forecasters, confidence interval, recommended action, what would change the forecast.
- **Why:** Codex flagged: "the plan lacks a concrete concierge operating model." Without these artifacts you'll improvise on every call, lose data, and get incomparable founder experiences.
- **Pros:** Repeatable. Comparable across founders. Generates the weekly artifact each founder gets, which IS the value the founder receives.
- **Cons:** ~3-4 hrs upfront. Needs iteration after first call.
- **Context:** Codex review identified missing pieces explicitly: founder list, outreach copy, call script, intake form, decision selection criteria, who creates markets, who supplies context, weekly report.
- **Effort:** S (founder time).
- **Depends on:** Nothing.

### Founder-call confidentiality checklist (replaces /cso framing for concierge)
- **What:** A plain-English one-pager answering: "what data goes into Telarchy when you sign up?", "who can see your workspace?", "do AI participants in your private workspace have access to your KPIs? If yes, which ones, and how do I revoke?", "how do I export my data?", "how do I delete everything?". Linked from the call script.
- **Why:** Codex correctly reframed: the security question for concierge is NOT "is the code safe to open-source," it's "can a founder safely paste their confidential KPIs into this hosted system with AI participants?" Founders will ask. The answer needs to be ready, not improvised.
- **Pros:** Answers the unspoken concierge objection. Reusable for every future founder call.
- **Cons:** Forces you to answer real questions you may not have answers to (e.g., "actually, the master API key is static in .env" — that one needs fixing first).
- **Context:** Codex outside-voice review reframed the /cso entry. /cso the skill is still useful but for a different reason (general security hygiene, not open-source readiness).
- **Effort:** S.
- **Depends on:** Honest answers to the questions above. May surface code fixes.

### Email lifecycle: welcome + first-trade + day-3 nudge — DEFERRED to post-verdict (was Week 0)
- **What:** Wire one transactional provider (Resend or Postmark). Send: welcome email (with workspace URL), first-bot-trade notification (with consensus delta), day-3 re-engagement nudge.
- **Status change (2026-04-29 codex review):** Demoted from Week 0 P1 to **post-verdict P1**. Codex argued: 5 concierge founders don't need a transactional provider — manual personal emails are warmer and higher signal. User accepted. Email lifecycle becomes a launch-readiness item, not a concierge-readiness item.
- **Why (post-verdict):** Once the wedge is locked and the broader launch is on the calendar, transactional email is non-negotiable. Pre-launch with a small named cohort, manual is better.
- **Effort:** S→M (CC).
- **Depends on:** Week-4 verdict.

### Concierge tracking sheet + pre-committed falsification criteria
- **What:** Create `docs/concierge-tracking.md` with: (a) founder × stage matrix (recruited / call done / workspace live / week-1 metric update / week-2 return / week-4 verdict); (b) pre-committed falsification thresholds (e.g., "majority of cohort update a metric a second time without prompting" for week-2 retention; "≥2 founders say a market changed their mind on a real call" for week-4 verdict). Scale thresholds to whatever cohort size is actually booked.
- **Why:** Prevents goalpost-drift during the program. Makes the Week 4 verdict binding instead of felt-sense. Without pre-committed criteria, observation moves the line.
- **Pros:** 30 minutes of work. Removes the dominant epistemological failure mode.
- **Cons:** None.
- **Context:** Falsification criteria proposed in CEO plan Step 0E. User to lock in actual thresholds before Week 1.
- **Effort:** S.
- **Depends on:** Nothing.

### Doc rewrites: soften open-core language
- **What:** Rewrite the open-source / open-core sections of `docs/vision.md` (§ Business Model), `docs/go-to-market.md` (§ Approach: Managed Service Today, Open Core Later), and `AGENTS.md` (§ Canonical positioning, "Do not claim open source today" — already correct, but the surrounding sentence "The plan is open-core after the participant network moat is established" should soften to "open-sourcing is a possibility we'll evaluate at a later stage; no commitment today").
- **Why:** Self-consistency in public-facing docs before founder calls. User has decided not to commit to open-core because (a) business model is unsettled and the choice is one-way, (b) current security gaps would be exposed by going public.
- **Pros:** ~1 CC-hour. Removes a future credibility pitfall.
- **Cons:** Slight community-memory tax if you ever flip back to "we plan to open-source." Acceptable given hedged framing.
- **Context:** Decided during CEO review CP5. The `vision.md` § "Business Model" currently reads "Planned direction: open core" — most committed. `go-to-market.md` § "Approach" is intermediate. `AGENTS.md` is already hedged correctly.
- **Effort:** S.
- **Depends on:** Nothing.

### Minimum-viable launch backlog (carry-over from MVP backlog)
- **What:** Pricing one-liner on landing ("Free during beta. Self-host evaluated later."). Display name on signup + sidebar identity (eval finding 1). 504→404 catch-all verified in prod (eval finding 7.15). `/guides` discoverability from the landing nav (replaces "GitHub link" plan; addresses MVP eval finding 14 the open-source-honest way).
- **Why:** Floor for any launch surface, including concierge invitees who'll click around the marketplace before the first call.
- **Effort:** S→M (CC).
- **Depends on:** Nothing.

---

## P1 — Week 1 (first week of concierge)

### CP1 stage 1: /leaderboard page — SHIPPED 2026-05-01
- **What:** Page at `/leaderboard` listing every participant active in a public workspace, ranked by calibration. Columns: rank, agent name, calibration, accuracy, total earnings, last trade timestamp. Top 10 visible without scroll.
- **Why:** CP1 (parallel agent-eval surface) accepted. Distribution insurance + alt-wedge experiment.
- **Status:** Live behind the public `GET /api/leaderboard` endpoint, restricted to public-visibility workspaces. Sidebar nav link added 2026-05-01 (deviates from the original "no nav link until Week 4" plan; the concierge concern was that visible bot rankings would distract calls, but the page is on the Platform sidebar group, not the workspace group, so it stays out of the way during a workspace-focused call).
- **Code:** `functions/src/lib/leaderboard.ts`, `functions/src/routes/leaderboard.ts`, `src/pages/LeaderboardPage.tsx`. Browse spec at `qa/browse/00-anonymous/leaderboard.md`.

### CP1 stage 2: agent-eval workspace template + register-your-agent doc
- **What:** New workspace template (`agent-eval`) with metrics oriented at agent benchmarks (calibration on a fixed proposal set, hallucination rate, latency p99). New `/guides/agents` doc covering API key registration, hooks subscription, telemetry protocol with copy-pastable examples.
- **Why:** Completes the agent-builder surface. Anyone landing on `/leaderboard` should have a 1-click path to "register my agent."
- **Effort:** M (CC). Template is concrete; doc is largely consolidating existing material from `agent-economy.md` and `agent-telemetry-protocol.md`.
- **Depends on:** None blocking.

### CP3b: Persona 4 (founder) smoke test — narrowed from 4 personas
- **What:** Run the persona protocol (`docs/personas/_protocol.md`) for persona 4 (Marcus, startup founder) against the live product. File findings in `docs/personas/findings/04-2026-XX-XX.md`.
- **Status change (2026-04-29 codex review):** Narrowed from 4 personas (3, 4, 6, 11) to 1 (4 only). Codex argued synthetic persona runs are mostly procrastination. Counter-argument: the 04-19 run shipped 6 real bug fixes. Compromise: run only the persona that maps directly to the concierge target (Marcus the founder), to catch the 504/login/template-broken class of bugs that would kill a real concierge call in 30 seconds. Skip 3, 6, 11.
- **Why:** Smoke-test the exact flow the concierge founders will hit before the first call. Catches concrete product bugs without simulating thesis validation.
- **Pros:** ~1 CC-day. High-leverage prep before week 1.
- **Cons:** Synthetic run won't catch thesis bugs (concierge calls do that).
- **Effort:** S (CC, ~1 day).
- **Depends on:** Week-0 launch backlog items shipped first.

---

## P2 — During or post-concierge

### Claude Code skill: founder workspace setup ("/setup-telarchy-workspace" or similar)
- **What:** A new Claude Code skill that walks a founder through: (1) define top 3-5 KPIs as metrics with the right time-preference horizons, (2) connect data sources (manual, text source, API webhook), (3) supply private business context as a Source so AI participants can forecast, (4) surface a current decision as a proposal and review the conditional-market output, (5) check in weekly with metric updates. The skill calls the Telarchy API the same way any participant would (per AGENTS.md "frontend goes through the public API" rule).
- **Why:** Three benefits in one. (1) Eases concierge onboarding — you don't have to do every workspace by hand. (2) Self-service path for founders who DM you post-launch when you can't take a call. (3) Marketing artifact: "install this Claude Code skill, get a forecast-aware workspace in 10 minutes" is a sharp story for the Claude Code community.
- **Pros:** Multiplier on the existing `telarchy` skill (which is API-usage-focused). This one is workspace-setup-focused.
- **Cons:** Effort to build right (~1-2 CC-days). Needs the Telarchy API to be ergonomic for skill-driven calls — if the API requires too much hand-holding, surfaces ergonomics gaps that are themselves real findings.
- **Context:** User idea surfaced during codex outside-voice review of CEO plan, in response to the forecaster context gap. The skill is the natural force-multiplier for Hybrid Approach A (you hand-feed context per workspace, skill makes it 10x easier).
- **Effort:** S→M (CC).
- **Depends on:** Concierge calls revealing what founders actually struggle with during setup; build skill *after* week 2 so it's grounded in real friction.

## P2 — Post-verdict (Week 5+)

### CP4: Public spectacle markets (post-launch distribution)
- **What:** Build OG-image renderer for `/markets/:id`. Curate one opinionated public conditional market on a tech-news decision (e.g., "Will OpenAI release GPT-5 before Q3 2026?" composed against AI funding flow + competitor responses + enterprise adoption). Bots seed liquidity. Founder posts daily on X/HN. New seed market every 1-2 weeks.
- **Why:** Distribution-by-spectacle is the cheapest top-of-funnel motion. Each shareable market is an ad. Mechanism is already built; gap is OG-image rendering and curation cadence.
- **Pros:** If even one market goes viral, distribution is solved. Content compounds.
- **Cons:** Founder-time competing motion. Pre-launch this dilutes the focus gate; post-verdict it's appropriate.
- **Context:** Deferred from CP4 of the 2026-04-29 CEO review. Reason: concierge already saturates Week-1 through Week-4. Revisit after Week-4 verdict.
- **Effort:** human ~2 hr/wk ongoing / CC ~3-5 days upfront.
- **Depends on:** Week-4 verdict (positive or pivot — both unblock this).

### Post-verdict open-source decision revisit
- **What:** Re-evaluate open-source strategy after: (a) Week-4 concierge verdict locks the wedge; (b) /cso security pass cleared the gaps; (c) business-model conviction increases (e.g., enterprise pilots, transaction-fee data).
- **Why:** User correctly punted on open-sourcing today. The decision should be revisited when the inputs change.
- **Effort:** Founder thinking time, not CC.
- **Depends on:** All three inputs above.

---

## P2 — Prize seasons (deferred from Season 1, added 2026-08-17 by /plan-eng-review)

Legal posture: `docs/legal/trader-compensation.md`. All three were raised during
review, deliberately deferred by the owner to keep Season 1 simple, and are
expected to matter more as the pool grows.

### Exclude mid-season voided markets from season scoring
- **What:** Change season scoring so a market voided during a running season contributes nothing to any entrant's score.
- **Why:** `computeTradingProfit` floors a void refund at zero, so a buy on a voided market reads as exactly zero rather than a loss, while selling out above cost before a void keeps the gain. Verified at `functions/src/__tests__/leaderboard.test.ts:388-431` ("a plain buy on a market that voided reads exactly zero, not a loss" and "selling out above cost before a void keeps the gain, with no refund"). The payoff is asymmetric, and the owner controls the void button, so voiding becomes part of the contest.
- **Pros:** Removes an asymmetry an entrant could accuse the operator of exploiting, and removes the temptation.
- **Cons:** Real code in the scoring path, and a rule harder to explain than "we do not void during a season."
- **Context:** Season 1 handles this with a rules commitment only: no voiding during a running season except for a declared, announced error. That commitment gets expensive to keep if a later season runs while markets are being actively corrected. Raised by Codex in the outside-voice pass.
- **Effort:** S-M (CC).
- **Depends on:** The `loadBoard` extraction (`functions/src/lib/leaderboard.ts`) landing first.

### Sybil identity gate for prize entry
- **What:** Require a linked Manifold account, or one entry per `authUser`, before a participant can enter a prize season.
- **Why:** Credits are free, entry is free, new accounts get a baseline of 0, and five places pay. The simplest winning strategy against an 11-row board is one person running five accounts, not forecasting. The baseline-0 rule for new accounts (introduced to close a separate entry-timing exploit) is what makes it cheap.
- **Pros:** The gate already exists as the identity check behind `weeklyActiveVerifiedTraders` (a synced Manifold account), so it is a lookup rather than a new system. It also aims the season at the audience the owner named: existing Manifold and Metaculus forecasters.
- **Cons:** Excludes anyone unwilling to link an external account, which on a board this small could make the next season smaller than Season 1.
- **Context:** Explicitly accepted as a Season 1 risk (owner: "simple setup first and ill iterate on it after"). Season 1 relies instead on manual settlement (the owner reviews standings before assigning prizes) plus a disqualification clause in the published rules. Bounded downside at a $1,000 pool; the failure is public.
- **Effort:** S (CC).
- **Depends on:** Season 1 finishing, so the decision is made against real data on whether farming showed up.

### Record participant-deletion unwinds as real trades
- **What:** When a participant is deleted, write the unwinding of their positions as actual trade rows instead of moving the market's shares and pool directly.
- **Why:** AGENTS.md already names this as a known, currently-sanctioned gap: deleting a participant moves shares and pool directly, "so the price moves and no row explains it." What is new is the consequence: during a prize season that silently changes every other entrant's marked value, and therefore the standings, with nothing in the ledger accounting for it.
- **Pros:** Closes the last price movement no ledger row explains, which matters more once the board decides who receives money.
- **Cons:** Touches the append-only ledger path and `allowLedgerAdmin`, the code most worth leaving alone.
- **Context:** Pre-existing, not created by the season work. AGENTS.md already concludes "recording the unwind as real trades would be better."
- **Effort:** M (CC).
- **Depends on:** Nothing, but riskier than it looks.

---

## P3 — Nice-to-have (deferred)

- Per-market OG image endpoint (subset of CP4 if CP4 is rejected).
- Shareable artifact after a trade or forecast.
- Referral hook (500-credit bonus both sides). Needs credit-grant audit trail before wiring to `/api/agents/:id/credit`.
- Position visibility per-workspace setting (front-running prevention vs social trading; deferred per `go-to-market.md` § Key Decisions).
- Wallet connect (one-click USDC deposit) — gated on managed-instance USDC settlement legal posture.

---

## Added 2026-08-24 (eng review of the open-source release)

Note: the P1/P2 items above date from the 2026-04-29 CEO plan and predate the console
deletion (2026-08-19) and the open-source decision (2026-08-24). Treat them as history;
the live plan is `telarchy/notes/open-source-execution-plan-2026-08-24.md`.

### Open-core split of the market engine into a package (P3, trigger-gated)
- **What:** Extract the AMM, formula and proposal-market logic (`functions/src/lib/amm.ts`, `functions/src/lib/formula/`, `functions/src/services/markets.ts`) into a published package other products can embed; the app becomes its first consumer.
- **Why:** A second distribution channel and a code-level boundary between the engine and managed-only concerns (federation, enterprise), instead of a policy boundary behind config.
- **Pros:** Embeddable engine; the private part of the repo becomes obvious; cleaner dependency graph.
- **Cons:** A refactor before anyone has asked to embed it; nothing today is managed-only except infra config, so the boundary would be drawn by guess.
- **Context:** Design doc `telarchy/notes/open-source-decision-2026-08-24.md`, Approach B. Deferred at the 2026-08-24 eng review because it can be done later without republishing anything (the public repo is AGPL either way).
- **Depends on / trigger:** the first outside party asking to embed the engine, or the first managed-only module appearing in the codebase. Do not start before one of those exists.
- **Effort:** M (human ~3 weeks / CC ~2 days).
