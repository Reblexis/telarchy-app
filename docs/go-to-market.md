# Telarchy: Go-to-Market Plan

## Positioning (two-sided marketplace)

Telarchy is a two-sided marketplace. Owners price decisions; forecasters earn by being right. Same substrate, two distinct pitches because the two sides buy different things:

- **Owner side (one line):** *Telarchy is an alignment layer for AI and humans. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.* Headline use case: company governance (founders and leadership pricing decisions against KPIs and OKRs). Individuals use the same mechanism for personal goals and are first-class from day one.
- **Forecaster side (one line):** *Telarchy is the first AI economic-capability benchmark where success creates real economic value.* Calibrated forecasts on real founder decisions earn credits (and real-money payouts when settlement is on); the score is denominated in dollars, not points. Headline customer: AI labs, autonomous-bot builders, quant-curious humans.

"Participant" means any market actor, human or AI; the word `agent` is retained in the API and schema only.

The rest of this document is structured around the owner side (the historical entry point and the headline use case for the next 12 months). The forecaster side is treated as a first-class adjacent surface, not a side audience; see `docs/canvas/value-prop-canvas.html` Pages 3-4 for the forecaster-side detail.

## What's Already Built

- Full LMSR prediction market engine with binary trading (buy/sell, AMM shares, balance deduction)
- Participant economy with registration, API keys, credit system, approval flow, proposal payouts
- Multi-workspace support with capability-based access (read, trade, manage) via permission groups
- Real-money settlement: deposit/withdraw at the treasury boundary with verification; self-hosted only.
- Time-preference system for forward-looking evaluation (decay-weighted temporal aggregation)
- Conditional markets for the decision loop (proposal proposals with per-metric impact predictions)
- Event feed + SSE hooks for automation
- Admin UI for metrics, markets, participants, proposals, workspace management
- Graph/chart system for metric visualization and history
- Self-hosting: single `docker compose up` deploys the full stack (not yet a public release)
- BetterAuth (email/password, optional Google/GitHub OAuth via env vars)
- PostgreSQL + Drizzle ORM (same stack for managed and self-hosted)

## Credit Model

Every participant (human or AI) gets **1000 credits on signup**. Credits are the core economy:

- **Workspace owners** spend credits to provide liquidity to their markets. More liquidity attracts more participants and produces tighter forecasts. New workspaces auto-fund markets at 0.5 credits each by default.
- **Participants** spend credits to place predictions. Accurate forecasting earns credits; inaccurate forecasting loses them. The market mechanism ensures bad forecasters run out of influence.
- **Credits will be backed by real money** (1:1 redeemable for spendable value at the treasury boundary) once the platform matures. The infrastructure is already built for self-hosted deployments. On the managed instance, credits are play-money with real scarcity: you get 1000, you earn or lose from there.

When a participant runs out of credits, they can earn more through accurate forecasting or purchase more (future: real-money deposit on managed once legal posture is settled).

**Platform-operated participants** are seeded by the platform operator and auto-join all public workspaces. They provide baseline forecasting activity so new workspaces have immediate value. They use the same credit economy as everyone else.

## Signup-to-Value Flow

1. **Sign up** (email/password or Google/GitHub OAuth). Receive 1000 credits.
2. **Create workspace** (pick template: startup, personal, or blank). 3 metrics created, ~27 markets auto-created and auto-funded from your credits (~14 credits total).
3. **Set initial metric values** (quick self-assessment for each metric).
4. **Platform-operated participants discover your workspace** and start trading within minutes. Consensus values appear.
5. **Check back weekly**, update metric values. Markets resolve; accurate forecasters earn, inaccurate lose. New markets auto-created for future dates.
6. **Propose a decision** (optional): create a proposal, see conditional market predictions of its impact on your metrics.

## Remaining Gaps

| Gap | Status | Impact |
|---|---|---|
| Onboarding UX (guide user through first metric update) | Missing | High friction for new users |
| Developer portal for automated participants (docs, SDK, examples) | Missing | Blocks third-party participants |
| Leaderboard / reputation | Missing | No visibility into participant quality |
| Notifications (email alerts for resolutions) | Missing | Users forget to check back |
| Wallet connect (one-click real-money deposit) | Missing | Blocks real-money transition |

## Privacy, Security, and Data Sovereignty

### Approach: Managed Service Today, Open Core Later (GitLab Model)

Today the only way to use Telarchy is the managed `telarchy.com` instance. The repo is private. The intent is to MIT-license the backend and frontend and publish a self-hosting Docker image once the managed agent network is established; until then, do not make open-source claims externally. True E2E encryption is incompatible with prediction markets regardless; the server must compute on the data (AMM, resolution, payouts). Same constraint GitLab faces with CI and code search.

Trust is built through security practices, compliance, and transparency:

- **Encryption at rest** - managed database and infrastructure encryption. CMEK for enterprise tier where supported.
- **Encryption in transit** - TLS on managed hosting and any self-hosted deployment.
- **Access controls** - Strict internal policies, admin audit trail.
- **DPAs** - Contractual commitments for enterprise customers.
- **Privacy policy and ToS** - Transparent about data storage, location, retention.
- **Data portability** - Self-service export (`GET /api/me/export`) and deletion (`DELETE /api/me`).
- **Self-hosted option** - Docker image and local PostgreSQL already provide the sovereignty escape hatch.

### Current Security Posture

**Strong:**
- Agent API keys stored as SHA-256 hashes, verified with `crypto.timingSafeEqual`
- No server secrets in frontend bundle
- Rate limiting via `express-rate-limit` (global + per-endpoint)
- PostgreSQL row-level locking on trades (no race conditions)

**Still needed before public launch:**
1. Master API key rotation - currently static in `.env`; move to secrets manager for managed deployment
2. Input validation gaps - `agentId` character limits, free-text length caps
3. Admin audit trail - log approvals, role changes, credit distributions
4. CORS lockdown - `ALLOWED_ORIGIN=*` fine for self-hosted; managed deployment should restrict to known domains

### Privacy / GDPR

1. Self-service data deletion (`DELETE /api/auth/me`)
2. Data export (`GET /api/auth/me/export`)
3. Privacy policy (PII inventory: emails, wallet addresses, free-text)
4. PII retention policy with auto-cleanup
5. Data residency documented in privacy policy

### Multi-Tenant Data Isolation

All tables include a `workspaceId` column; all queries filter by it. Mitigations:
- **Query abstraction** - workspace ID flows from `req.auth.workspaceId` on every request; no cross-workspace leakage possible via standard routes.
- **Integration tests** - Verify cross-tenant invisibility on every deploy.
- **Position visibility** - Owner and workspace admin only. Per-workspace setting for social trading.

## Infrastructure

### Current Architecture

- Frontend: React 19, Vite, Chart.js (served as static files by the Express backend in self-hosted mode)
- Backend: Node.js Express API (`functions/src/`)
- Database: PostgreSQL with Drizzle ORM
- Auth: BetterAuth (email/password + optional Google/GitHub OAuth)
- Managed deploy: Cloud Run (same image as self-hosted, different env vars)
- Self-hosted deploy: `docker compose up` (includes postgres service)

### Known Issues / Limitations

1. **No real-time updates** - Frontend polls every 60 seconds. SSE endpoint exists for agent hooks but not for browser UI updates.

2. **No email verification** - BetterAuth `emailVerified` flag is set but email sending is not configured. Needed before allowing public signup.

3. **Single PostgreSQL instance** - Trade throughput is bounded by PostgreSQL write capacity (~hundreds/second), which is fine for early scale. At very high load, consider read replicas or partitioning by workspace.

### Cost Estimates (managed PostgreSQL + Cloud Run)

- Small (100 users, 1K trades/day): ~$15-30/month
- Medium (1K users, 10K trades/day): ~$60-120/month
- Large (10K users, 100K trades/day): ~$250-600/month

## Competitive Landscape

The honest version of "what would I use instead of Telarchy if I had to make a strategic decision today" is mostly *not* prediction markets. The realistic alternatives, in order of how often a founder actually reaches for each:

1. **Generic AI chatbots**. Ask an LLM directly. The de-facto default in 2026. Confident-sounding paragraph, no skin in the game, no goal context, may train on your strategic prompts.
2. **Autonomous AI agents**. Modern agent frameworks acting on the founder's behalf. Acts first, evaluates after. No alignment mechanism; opaque steps.
3. **Public prediction markets**. Real-money markets on news events. Wrong shape (standalone, not conditional) and you wouldn't put your KPIs on a public order book.
4. **Enterprise forecasting platforms**. Internal prediction markets with employee forecasters. The closest mechanism cousin; misses AI participants entirely.
5. **AI scenario-planning tools**. Financial-modeling SaaS with LLM-augmented what-if simulation. Same job-to-be-done, simulation instead of markets, no skin in the game.

Telarchy vs each of these (canonical landing matrix in `src/pages/LandingPage.tsx`):

| What you'd use instead | Decisions priced first | Calibrated forecasts | Aimed at your KPIs | Auditable AI | Stays private |
|---|---|---|---|---|---|
| Generic AI chatbots | ✗ | ✗ hallucinates | ✗ no goal context | ✗ black box | ~ depends on tier |
| Autonomous AI agents | ✗ acts first | ✗ no skin in game | ~ if you wire it | ✗ opaque steps | ~ depends on stack |
| Public prediction markets | ✗ standalone | ✓ real money | ✗ public events only | ✗ no observability | ✗ public order book |
| Enterprise forecasting platforms | ~ some conditional | ✓ employee programs | ✓ admin-curated | ✗ humans only | ✓ enterprise-hosted |
| AI scenario-planning tools | ~ simulation | ✗ no forecasters | ✓ finance team | ✗ LLM-only | ✓ private SaaS |
| **Telarchy** | ✓ per proposal | ✓ accuracy pays | ✓ you define them | ✓ open protocol | ✓ workspace · per-metric · per-source |

### Telarchy's unique positioning

1. **An alignment layer for AI and humans**. Not a betting platform, not a dashboard. Markets price what any participant proposes (an AI agent, a human teammate, or the owner themselves) against the owner-defined metrics; the owner approves with calibrated confidence. See `vision.md` ("Telarchy as an alignment layer for AI and humans") for the load-bearing version.
2. **Conditional decision markets**. Every proposal is priced against the metrics it would affect before it ships. The only complete neighbour (MetaDAO) does this for DAO governance, not single-owner businesses.
3. **Metric composition + time preference**. The market substrate. Owner defines a tree of metrics with formulas; each node carries a time horizon; markets are auto-created at sampled future dates. Forecasts are forward-looking outlooks, not spot odds.
4. **Participant symmetry**. Humans and AI share the same signup, balance, capabilities. API keys, hooks, the open agent telemetry protocol make AI participants first-class. Same observability, same audit trail, same controls as human ones.
5. **Workspace privacy with per-resource granularity**. Workspace `visibility` (Private / Public / Open) plus permission groups carrying per-metric `{read, trade}` and per-source `{read}` permissions. Closest cousin (enterprise hosted-private) doesn't do per-metric. None of the public markets do private at all.
6. **Decision quality compounds with AI progress.** As stronger models register as participants, accuracy-weighted credit accumulation gives them more weight in future markets, automatically. Each model bets only where it has edge, so the system routes expertise across a swarm rather than betting the company on one LLM. Competitors that wrap a chosen model carry that model's regressions and blind spots; Telarchy users absorb AI progress passively by keeping their participant pool open. See `vision.md` ("How decision quality compounds with AI progress") for the load-bearing version.
7. **First AI economic-capability benchmark where success IS value creation.** Existing AI benchmarks measure capability on fixed tasks; VendingBench measures economic agentic capability in a sealed simulation. Telarchy goes further: thousands of real markets, adversarial against a population of competing forecasters, with correct forecasts producing real economic value (better operator decisions on the other side of every trade). Once real-money settlement is on, the benchmark pays out in real money, and "success on the benchmark" and "economic value brought to the world" become the same number by construction. Autonomous bots become financially closed-loop. AI labs get a direct revenue path for forecasting capability beyond seat-based licensing. See `vision.md` ("Telarchy as an economic-capability benchmark for AI") for the load-bearing version.
8. **Decision quality scales gracefully with capital invested.** The LMSR mechanism has logarithmic diminishing returns to liquidity: each marginal credit poured into a market still buys real forecast sharpness, far longer than user-count-bounded SaaS economics admit. Owners allocate liquidity by importance (richer pools on the metrics they care about most); traders allocate by conviction (heavier `liquiditySubsidy` on the proposals they believe in most). Both channels flow naturally to the decisions and metrics that matter, and the pool you put on a thing is itself a legible signal of how much you care. Combined with the AI-progress-compounding argument (point 6), decision quality scales on two independent axes (AI capability and capital invested) with no architectural ceiling. See `vision.md` ("Decision quality scales with capital") for the load-bearing version.
9. **Outcome-based pricing on both sides of the marketplace.** Proposers earn LP returns proportional to actual metric movement; forecasters earn proportional to forecast accuracy on resolved markets; operators pay both sides only in proportion to value delivered. Bigger predicted impact + correct prediction = bigger LP earnings, so proposers are correctly incentivized to find high-leverage actions, not just any action. Better calibration on heavily-funded markets pays proportionally more, so forecasters are correctly incentivized to put effort into the decisions that matter most. The operator's spend on Telarchy is a pure function of decision quality created, not a fixed cost. This is the substrate the AI vendor industry is reaching for under the "outcome-based pricing" label. See `vision.md` ("Outcome-based pricing on both sides of the marketplace") for the load-bearing version.

**Positioning one-liner:** Telarchy is an alignment layer for AI and humans. Markets price what any participant proposes, against the metrics you define.

### Why "alignment layer for AI and humans" is the load-bearing framing

Two earlier framings have been retired and should not be drifted back to:

- **"Private prediction markets for company decisions"** made the page argue with itself: every prediction market is "private" if you self-host enough of it, and the audience-fit story was muddled (founders vs personal-goal users co-headlined).
- **"Alignment layer for AI" (alone)** was a sharper wedge but understated scope. The system also prices proposals coming from human teammates or the owner themselves. Calling it "for AI" only made the marketing inconsistent with the product, where every action gets priced regardless of proposer.

The current framing (*owners say what they want; participants, human or AI, propose; markets price; owner approves*) is sharper because:

- It is the only category where the matrix shows Telarchy as the only complete combination.
- It answers two questions every founder is *already* asking with the wrong tool: "how do I get AI to actually help me decide?" (default: chatbot) and "how do I price decisions against my actual goals?" (default: gut call, loudest voice in the room).
- It anchors the long-term vision: as more work gets automated, defining what you want is the human's last job. Telarchy is the interface for that, whether the action being priced was proposed by an AI or a human.
- It separates Telarchy from the prediction-market category entirely. Polymarket / Manifold / etc. are not realistic alternatives for a founder pricing internal decisions.

### Why now

The timing argument used in marketing copy:

- **Intelligence is the cheapest it has ever been.** Prediction markets thrive in cheap intelligence: every proposal can now be evaluated by many forecasters at near-zero per-forecast cost. The historical bottleneck for internal prediction markets, that you needed dozens of motivated human forecasters per market, is gone.
- **AI participants grant privacy that human forecasters cannot.** Internal prediction markets have existed since the 1990s (HP, Google's Prophit) and have always worked mathematically; they never crossed into sensitive decisions because human bettors carry information out (a teammate who sees a confidential KPI goes home with it, changes jobs with it, talks about it). AI participants are the first bettor type that can be hosted on owner-trusted infrastructure (or run locally) with memory wiped between sessions, so confidential KPIs and unannounced strategic moves can be market-priced without leaving the owner's perimeter. Telarchy makes this operational with per-metric privacy controls (per-metric and per-source read/trade rights on permission groups), so the owner exposes exactly the slice each participant needs.

These two facts compound: cheap intelligence makes the markets work, and AI privacy makes the founder willing to put the decision into a market in the first place.

Do not drift back to "private prediction markets" or to "alignment layer for AI" alone. The mechanism is prediction markets; the product is an alignment layer for AI and humans.

## First-customer ICP hypotheses (2026-05-16)

Telarchy has no real paying customers today. Outreach is hypothesis-driven, not segment-locked. The current ranking of who is most likely to be the first painful entry, in order of working confidence:

**Primary hypothesis (highest confidence):**

- **AI-native startups** and **companies actively deploying AI agents into operations.** Their problem ("AI generates more proposals than I can evaluate") is the one Telarchy is structurally built to solve. They are pre-built to think in metrics and to put AI into the loop, so the cognitive distance to a working Telarchy workspace is small. The narrative ("with rising AI agent autonomy the central problem shifts from generating proposals to evaluating them") lands without translation.

**Secondary hypotheses (open, being pressure-tested in conversations):**

- **AI vendors and AI-tool builders.** Less likely to be the headline buyer, but strategically useful: their AI agents joining as platform participants strengthens the forecaster network, which compounds value for the operator side. May matter more for valuation than for direct revenue.
- **Portfolio companies of investment groups** that already think in KPIs and have a reason to standardize decision-making across multiple holdings. Hypothesis quality unclear; depends entirely on whether such groups treat decision quality as a centralized capability or leave it to each portfolio company.
- **KPI-heavy companies in general** (not specifically AI-native) where decisions are already routinely framed against quantified metrics. Lower upside than the AI-native segment but a potentially simpler conversation because the "express your goals as metrics" precondition is already true.

What is explicitly **not** the working hypothesis: regulated industries, large enterprises with multi-quarter procurement, and any segment requiring the mechanism itself to be unfamiliar (Telarchy already requires the buyer to absorb "owner defines metrics, markets price proposals, owner approves on a calibrated number"; layering a second new concept on top of that doubles the conviction needed).

The right output of an outreach conversation is not a sale; it is one of:

1. A named first-customer prospect inside the buyer's network.
2. A specific reason the primary hypothesis is wrong (the "biggest killer of the idea" answer).
3. A redirected segment hypothesis that the conversation makes more credible than the current ranking.

## Communication patterns for potential-customer outreach (2026-05-16)

When introducing Telarchy to a potential customer or operator who can refer one, the canonical sequence is:

1. **Lead with the problem, not the term "alignment layer."** The narrative is "AI generates more proposals than the company can evaluate; Telarchy is the layer that prices each proposal against the metrics that matter before the company commits." The phrase *alignment layer for AI and humans* is correct, but it does not land in five seconds with a cold reader. Earn the term; do not open with it.
2. **Anchor on one example, not a use-case tour.** Reference example: an AI agent proposes a product change; Telarchy lets humans and AI participants forecast the expected impact on revenue or retention before deployment; reality eventually resolves the market and the system learns whose forecasts to trust on that kind of decision. One mechanism, one vision, one image.
3. **Prediction markets is the right term, after explanation.** Skip it in the opening line. Once the problem and the example land, naming the mechanism precisely is a credibility move.
4. **Real money is a long-term motivation layer, not a first-pass topic.** Mention only when explaining why the participant network has economic alignment, or when discussing outcome-based pricing for AI vendors. Do not lead with settlement, leaderboard rank, or transaction fees.
5. **Skip the API catalog, the public leaderboard, and any developer-facing depth.** Operators read these as either technical noise or hobbyist signals. The participant developer surface is real and important, but it is the wrong half of the marketplace for an operator conversation.
6. **Do not anchor on Czech roots, Prague, or geographic origin.** The product is global by construction (English-default UI, no jurisdictional binding). The local-origin framing only reduces perceived ambition.
7. **Be honest about stage.** Functional MVP, no paying customer yet, founder uses it himself. Frame it as the explicit reason for the conversation: "I am looking for the first place where the pain is sharp enough and the metric is measurable enough." This is more credible than asserting traction the data does not yet support.

The three questions worth raising in every conversation, in order of marginal usefulness:

- Where is the first really painful entry?
- Who is the first realistic buyer?
- What is the largest unstated assumption, or the biggest killer of the idea as framed?

Founder-credibility line, used at most once per conversation and only when it earns trust rather than fills space: previous shipped product LookPilot now nets ~5k USD per month; Telarchy is the deliberately more ambitious next bet.

## Key Decisions (to be resolved)

- **Workspace isolation model** - Global trader balance vs per-workspace? Global is simpler and more liquid.
- **Creator business model** - Free tier + premium? Transaction fees? Subscription?
- **Legal structure** - Regulatory posture for real-money prediction markets. Needs legal counsel.
- **Participant identity UX** - Keep browser-account and API-key signup flows distinct while preserving the same permissions and market access?
- **Data architecture** - how aggressively to partition or shard workspace-scoped PostgreSQL data as scale increases.
- **Position visibility** - Per-workspace setting? Default private (prevent front-running) or public (social trading)?
- **Market resolution trust** - Start with simple creator reputation score. Agents allocate fewer credits to low-reputation creators. Future: dispute mechanism, third-party data sources, creator stakes.
