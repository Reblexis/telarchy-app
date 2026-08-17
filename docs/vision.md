# Telarchy

## Mission and vision

**Tagline: the alignment layer for AI and humans.**

**Mission.** Align every action to your goals. Whoever proposes a move, a person or an AI, it is priced against the metrics the owner actually values before it is taken, and the owner approves on a calibrated number rather than a pitch. As AI takes on more of the work, this is how human goals stay in command of what actually gets done.

**Vision.** A world where you define what matters and AI does the rest, and you can always trust that what got done is what you wanted, because every action was priced against your goals before it happened. As AI takes over more of the operational work, this is the control surface that keeps the human in the loop without making them the bottleneck.

### What we are, and are not, solving

This is a real piece of the alignment problem, stated precisely so the claim stays honest (and credible to the people who know the term):

- **What Telarchy solves:** the control and oversight piece, for every action taken toward your goals, whether a person or an AI proposes it. You cannot fully verify a proposer's judgment (an AI has no skin in the game; a human is pitching their own project), so instead of trusting it you price each proposed action against owner-defined metrics, with forecasters who do have skin in the game, and a human approves with calibrated confidence. The market is the filter; accuracy pays, bias loses, and every decision is auditable. This matters most as AI starts to act, because that is where the volume of proposed actions explodes.
- **What Telarchy does not claim to solve:** value specification (choosing the right metrics is still the owner's job; the system faithfully optimizes whatever metric it is given, so metric design matters and Goodhart is a real failure mode) and inner alignment (whether a model is internally deceptive). Telarchy makes the owner's values explicit and forces every proposal to clear a market priced against them. That is the load-bearing slice, not the whole problem.

"Solve alignment" in the maximal sense is overreach, and claiming it costs credibility. "The alignment layer that keeps humans in control of AI and human actions, priced against what they actually value" is ambitious, defensible, and already what the mechanism does. The human stays in scope on purpose: the same market prices human proposals (gut calls, the loudest voice in the room), which is both a wider market and the reason the framing is "AI and humans," not "AI" alone.

## What Telarchy is

Telarchy is a two-sided marketplace where owners price decisions against the metrics they care about, and forecasters (human or AI) earn by being more accurate than the consensus. The two sides need different pitches because they buy different things from the same substrate:

- **Owner side: an alignment layer for AI and humans.** You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit. Founders and leadership teams use it to price company decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals.
- **Forecaster side: the first AI economic-capability benchmark where success creates real economic value.** Calibrated forecasts on resolved markets earn credits (and real-money payouts once settlement is on); the score is denominated in dollars, not points; better at the benchmark = more economic value brought to the world. Targets AI labs, autonomous-bot builders, and quant-curious humans.

Both sides run on the same prediction-market infrastructure: LMSR markets per metric, conditional markets per proposal, per-metric privacy controls, time-preference horizons, real-money settlement (see Phase 8 for the current implementation). The headline use case for the owner side is company governance; the headline use case for the forecaster side is portable AI calibration that pays.

### Trader-first sequencing (owner decision, Viktor, 2026-08-08)

A two-sided marketplace is bootstrapped one side at a time, and Telarchy solves the **trader side first**. Until trader demand is proven on the live flagship workspace (LookPilot), the product IS the trader experience:

- **Every account is a trader by default.** Signup lands in the trading surface with the signup grant; there is no intent picker and no owner onboarding in the product.
- **Workspace creation is waitlisted.** `telarchy.com/manage` is the owner side's entire surface for now: a pitch and a waitlist signup. `POST /api/workspaces` and the workspace-creating path of `POST /api/onboard` are platform-admin-only; everyone else receives 403 with a pointer to the waitlist. The operator provisions workspaces for design partners by hand.
- **The app shell matches the audience.** Participants whose role everywhere is trader/viewer see a trader shell (markets, ballot, leaderboard, account); owner chrome (metric management, sources, settings, check-in, participant admin, create-workspace) renders only for participants who hold manage somewhere.

The mission (alignment layer for AI and humans) and the owner-side positioning are unchanged; this is go-to-market order, not a product redefinition. The owner side reopens when the trader side has demonstrated pull. Rationale: with zero external users, the scarce resource is a stranger's first minute, and the only first minute on offer today is trading a real company's roadmap.

Three mechanisms stack, always in this order:

1. **Conditional markets** price the per-metric impact of every proposal before you commit. This is the decision loop.
2. **Composed metrics** let a top-level goal decompose into measurable parts via formulas.
3. **Time preference** gives each metric a forecasting horizon, so markets predict trajectories, not snapshots.

## Participants

A **participant** is any market actor, human or AI. Participants share signup paths, balance, and trading rights. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, capabilities are identical. Accuracy pays; noise loses.

In the API, schema, and developer docs this same concept is called an **agent** (the word is kept in code and routes). In product copy and outward materials we use **participant** so the human/AI symmetry is not lost.

## Name and relation to futarchy

*Telarchy* combines **telos** (Greek: ultimate purpose, end goal) and **-archy** (Greek: governance, rule). Governance by purpose.

Futarchy (Robin Hanson, 2000) is the system this builds on: "vote on values, bet on beliefs." Its mechanism (conditional prediction markets that evaluate proposals against a welfare metric) is structurally identical. The one difference: futarchy requires a vote to define the welfare metric, because it was designed for groups that disagree on values. Telarchy removes that step. The owner defines their metrics directly. No voting, no aggregation. The same mechanism becomes usable by companies, individuals, and any other setting where one party can define the goal.

The closest existing category is **decision markets**: conditional prediction markets that execute decisions rather than merely forecast. Telarchy is a decision market system with three additions not found elsewhere: metrics that can be flat or composed into hierarchies via formulas, a proposal economy where participants propose proposals and earn for approved ones, and a time preference system for forward-looking evaluation.

## Core thesis

**Owners set goals, markets score actions against them.** A participant proposes an action. Conditional markets reveal the expected per-metric impact. The owner approves or declines with a calibrated number rather than a gut call. Participants whose forecasts are consistently accurate accumulate credits; inaccurate ones lose them. The market makes manipulation transparent and expensive. A bad proposal is rejected not by opinion but by the crowd's forecasts. A good one clears faster as the markets learn.

**Automation is a continuum, not a switch.** Today the market informs a human who decides; the human is faster and better-calibrated than they would be without it. As markets accumulate data and calibration improves, more decisions can clear without a human in the loop at all. The direction is an asymptote: less time spent deciding, more spent doing. The product delivers value at every point on the continuum, not only at the far end.

## Telarchy as an alignment layer for AI and humans

The post-AGI division of labor: humans say what they want; everything else is automated. Defining what you want, clearly enough that a system can pursue it, is one of the last jobs that doesn't go away short of brain-computer interfaces reading intent directly. Telarchy is a system designed for exactly that division of labor, and the same mechanism applies whether the proposer is an AI or a human teammate:

1. **Owner defines metrics**. The things they want, the structure that connects them, the time horizon they care about.
2. **Participants propose actions**. AI agents register via API key and propose proposals (`POST /api/proposals`); human teammates do the same through the UI. Either can put any decision on the table.
3. **Markets price the actions against the metrics**. Conditional markets compute the expected impact of each proposed action on every metric. Forecasters (human or AI) with skin in the game produce calibrated estimates.
4. **Owner approves with calibrated confidence**. The owner sees a number, not a pitch. The decision proceeds with the market's predicted impact attached, not with whoever argued loudest.
5. **Whoever owns the action executes**; metrics update over time, feeding back into the next round.

This is structurally an alignment mechanism. No participant (AI or human) gets a proposal approved unless the market predicts it will improve the owner-defined metrics. The market is the filter; accuracy pays out, bias loses money, and every decision is auditable in `/admin` via the open agent telemetry protocol (`docs/agent-telemetry-protocol.md`).

Today this matters because the realistic alternatives a founder reaches for both fail in the same way. For AI proposals, the default is a generic chatbot, which has no skin in the game and no goal context. For human proposals, the default is a gut call or whoever argues loudest in the room. Both produce the same biased forecasts as the proposer pitching their own project. As AI agents take over more of the operational work in companies, the bottleneck collapses to: who decides what to actually do? Telarchy's answer is "the owner, on a market-priced forecast", regardless of who proposed the action.

### Why now

Two compounding facts make this the right moment:

- **Intelligence is the cheapest it has ever been.** Prediction markets thrive in cheap intelligence: every proposal can now be evaluated by many forecasters at near-zero per-forecast cost. The thing that limited internal prediction markets historically (you needed dozens of motivated human forecasters per market) is gone.
- **AI participants grant privacy that human forecasters cannot.** This is structurally new. Internal prediction markets have existed since the 1990s (HP, Google's Prophit, etc.) and have always worked mathematically. They never crossed into the decisions founders actually want priced because human bettors carry information out: a teammate who sees a sensitive KPI goes home with it, changes jobs with it, talks about it; you cannot unlearn a sensitive KPI. AI participants are the first bettor type that can be hosted on infrastructure the owner trusts (or run locally) with memory wiped between sessions, so a confidential metric can be priced without anyone carrying the information out. Telarchy makes this operational with per-metric privacy controls (workspace permission groups carry separate read and trade rights per-metric and per-source), so the owner can expose exactly the slice each participant needs and nothing more. This unlocks pricing for the decisions that previously had no realistic forum: confidential KPIs, unannounced strategic moves, sensitive people decisions.

This framing is load-bearing for positioning, not a tagline. The mechanism (conditional markets + composed metrics + time preference + first-class AI and human participants + open audit) is what makes the alignment-layer story credible. Without those pieces it would be marketing; with them, it is a real control surface for any decision in a business.

### Choosable privacy: per-workspace, per-metric, per-source

Privacy in Telarchy is not a pricing tier or a deployment mode you commit to up front. It is a continuous setting that lives on three levels, and every one of them is the owner's to choose and to change at any time. This is what turns the "why now" privacy-unlock argument above into an actual product feature, and it is one of the main reasons an owner can put a decision they would never expose to human teammates in front of the market.

1. **Per-workspace.** A single Settings picker offers three access levels: **Private** (invite-only, not listed anywhere), **Public** (listed on `/api/marketplace`, joiners can view but not trade), and **Open** (listed, joiners can trade immediately). Under the hood this composes workspace `visibility` with the Public permission group's capabilities; the picker adjusts both atomically. New workspaces created through the UI default to Open so first-time users land on a live market, while the backend default for API-only and self-hosted callers (`provisionWorkspace` with no `visibility`) is the safer Private.
2. **Per-metric.** Permission groups carry a `permissions` map (`metricId -> { read, trade }`), so a participant can be granted forecasting rights on exactly one KPI while the rest of the workspace's numbers stay invisible to them. Exposure is a per-metric decision, not all-or-nothing per workspace.
3. **Per-source.** The same model extends to information stores via a `sourcePermissions` map (`sourceId -> { read }`). Context docs, credentials, or a connected GitHub repo can be shared with the precise set of participants that need them and withheld from everyone else.

The owner exposes exactly the slice each participant needs and nothing more. Combined with the AI-participant property from "Why now" (an automated forecaster can be hosted on infrastructure the owner trusts, or run locally, with memory wiped between sessions), this is what lets confidential KPIs, unannounced strategic moves, and sensitive people decisions be priced without anyone carrying the information out of the room. The implementation lives in the workspace-scoped `permissionGroups` table (see "Phase 1b: Permission Groups" and "Sources" below); this section is the positioning view of those primitives.

### How decision quality compounds with AI progress

The same mechanism that filters bad proposals also routes expertise across participants and absorbs AI progress automatically. Three properties fall out:

1. **AI progress compounds into the company without product-side model swaps.** When a stronger model is registered as a new participant, its forecasts beat weaker participants', it accumulates credits, and its predictions get more weight in future markets. No code change in the product, no swap-out of "the LLM" the company depends on, no hyperparameter tuning. The participant pool stays open; the company's decision quality tracks the AI frontier as a side effect.
2. **Each model contributes only where it has edge.** A rational participant stakes only when it expects to beat the current market price; staking outside its expertise costs credits. The result is emergent expertise routing: coding-strong models pull weight on engineering decisions, finance-strong models on pricing decisions, etc. The owner does not need to know which model to ask which question. The market answers that on its own.
3. **A market over many models is robust where any single model is brittle.** Choosing one LLM bets the company on that model's blind spots, regressions, and bad days. A market over a diverse participant pool aggregates each model's strengths and dilutes individual failures into one calibrated number.

Together these mean Telarchy is not "an LLM wrapper." It is the substrate that turns a continuously improving population of AI participants into continuously improving company decisions, without the company having to track which model is best this week.

### Telarchy as an economic-capability benchmark for AI

Existing AI benchmarks measure capability on tasks (reasoning, math, coding) or, in the most economically grounded case, performance in a sealed simulation (VendingBench-class). Telarchy is a strictly stronger frame:

| | Capability benchmarks | VendingBench-class | Telarchy |
| --- | --- | --- | --- |
| Domain | fixed task | single sealed simulation | thousands of real markets across all public workspaces |
| Adversarial | no | no | yes (against a population of competing forecasters) |
| Externalities | none | none, sealed sim | real economic value (operator decisions improve when forecasts are good) |
| Reward | leaderboard rank | sim-dollars | leaderboard rank + real credits + real-money payouts once settlement is on |

The load-bearing property: **success on the Telarchy benchmark IS economic value creation, by construction.** Capability benchmarks measure proxies. VendingBench measures sim-dollars. Telarchy measures forecasts that resolve against actual KPI movement on real businesses (or real personal goals); each correct forecast directly informs a real decision. The metric "AI agent's calibration on Telarchy" is not a proxy for "AI agent's economic value to a user"; the two are the same number.

This unlocks a category that does not exist anywhere else today:

- **For AI labs:** a public, auditable, dollar-denominated benchmark that does not saturate as quickly as capability benchmarks (because the population of forecasters competes adversarially; each model's edge erodes as others learn). Once real-money settlement is on, the benchmark pays out in real money and provides a path to direct revenue from forecasting capability that is independent of seat-based licensing.
- **For autonomous-agent builders:** a substrate where a profitable bot is financially closed-loop. A correct-enough forecaster earns enough at resolution to cover its own LLM and compute costs. Autonomy plus economic sustainability without external funding.
- **For the alignment / AI-safety community:** the first benchmark where "this model is more useful" and "this model creates more value" are operationally equivalent. Models that produce noise lose money and influence; models that produce calibrated forecasts gain weight in future markets, by mechanism, not by curation.

The implications for Telarchy positioning: the participant network is not just a moat (existing accumulated reputation), it is also a market. AI labs publish models as Telarchy participants; the labs that make the most money are also the ones whose models actually create economic value. The benchmark and the marketplace are the same surface.

### Decision quality scales with capital

The LMSR mechanism has graceful, logarithmic diminishing returns to liquidity: each marginal credit added to a market still buys real forecast sharpness, just less than the one before. Combined with the practical dynamic that bigger pools attract more and better forecasters (because the expected value of trading scales with pool size), the practical scaling is even gentler than the math alone suggests. There is no architectural ceiling: unlike user-count-bounded SaaS economics, where the marginal user eventually saturates the market, the marginal credit poured into a Telarchy market still buys value far longer.

This scaling property is conditional on a deep enough participant pool to absorb the capital. With a thin pool (a workspace's first weeks, or a brand-new specialty market with few experienced forecasters), additional liquidity primarily increases LP exposure rather than buying sharpness, because the same small set of traders captures the marginal pool. The pitch is "scales gracefully with capital once a participant pool exists", not "any amount of capital instantly buys decision quality." The participant network (point 5 of `go-to-market.md`'s positioning) is what makes capital scaling real; without it, capital is just LP subsidy to whoever happens to be trading.

This expresses itself in three places that operators and traders care about directly:

1. **Per-market sharpness.** Price sensitivity is `b = pool / ln(2)`. A bigger pool means a more sensitive price surface, so more forecasters find tradable edges, so more information enters the consensus. The expected loss to the LP is bounded at `b * ln(2)` (= the pool itself), which is paid only when the market consensus is wrong; on average, an LP recovers most of the pool through correct payouts and the cost works out as a deliberate subsidy to information.

2. **Per-workspace prioritization by liquidity.** Owners allocate liquidity by importance. Metrics the owner cares about most get rich pools (`autoFundNewMarkets` plus targeted `POST /predictions/markets/:id/liquidity` injections), pulling tight forecasts. Less critical metrics get smaller pools and looser consensus. Priorities become a continuous knob, not a binary "track or do not track" choice. The pool you put on a metric is itself a legible signal of how much you care.

**A conditional market is never born dead if anyone can pay (owner report 2026-08-15).** A proposal may name no `liquiditySubsidy`, and a market at zero liquidity has no price at all: it charts as nothing and the server refuses every trade against it, so a public floor shows jobs whose only response to a visitor is a refusal. Funding therefore falls through: the proposal's named contributors first, then the workspace's own auto-fund setting (`autoFundNewMarkets` x `newMarketLiquidityCredits`, debited from the workspace owner exactly as baseline markets are), and if the owner cannot cover the full amount, **whatever they can cover**, down to one nanocredit per market. A thin market is a market; all-or-nothing funding produced ten untradeable jobs on the Telarchy floor while its owner held 87 credits against a 500-credit ask. Only when nobody can pay anything do the markets spawn unfunded, and the floor then says so in place of the bet buttons rather than offering a bet the server must reject.

3. **Per-proposal conviction-weighted influence.** A trader confident in a conditional forecast can fund that market more heavily via `liquiditySubsidy` on `POST /api/proposals`, or via `POST /predictions/markets/:id/liquidity` on the specific market (any participant with the `trade` capability, funded from their own balance); admins can bulk-fund every market under a proposal via `POST /predictions/markets/liquidity/bulk`. Their conviction translates to influence in two ways: the trader's own position size, plus the LP subsidy that pulls other forecasters in to compete on the now-more-tradable market. High-conviction calls become high-signal markets, which is precisely the right thing.

The pair to the AI-progress-compounding argument: AI progress makes forecaster *quality* approach free; capital scaling makes forecaster *attention* allocatable to anywhere the operator or trader wants it. Decision quality scales on two independent axes, both gracefully, both without ceiling. The bottleneck is neither AI capability (which keeps getting cheaper) nor user count (which Telarchy does not depend on linearly); the bottleneck is willingness to allocate, and that is exactly where the operator's prioritization signal lives.

For investor framing: this is a strictly better growth model than user-count-driven SaaS. Telarchy's effective output (decision quality, calibration, real economic value created) keeps responding to capital injection long after a SaaS would have saturated. Combined with the participant-network moat (calibration history that source code cannot clone) and the AI-economic-capability-benchmark frame (where every dollar of liquidity converts directly to a dollar-denominated benchmark surface for the AI ecosystem), the marginal-credit math compounds favourably across all three positioning axes.

### Outcome-based pricing on both sides of the marketplace

The same mechanism that makes the system scale with capital also aligns economic motivation across all three roles in a Telarchy workspace. Telarchy is, structurally, outcome-based pricing on both sides of a marketplace, with the operator buying value in the middle. The unit (play-money credits today on telarchy.com, real-money settlement on self-hosted with settlement enabled) changes without changing the alignment property; the user-facing pre-settlement and post-settlement value maps live in `docs/canvas/value-prop-canvas.html` Pages 1+3 (play-money) and 2+4 (real-money).

- **Proposers** earn LP returns proportional to actual metric movement vs the conditional consensus they helped fund. A proposer who believes their proposal will move a metric dramatically can fund the conditional markets heavily; if the metric moves as predicted, the LP earns proportionally; if the proposal turns out to be a wash, the LP barely moves either way. Big predicted impact + correct prediction = big LP earnings. Big predicted impact + wrong prediction = big losses. The economics push proposers toward finding genuinely high-leverage actions, not just any action.
- **Forecasters** earn payouts proportional to forecast accuracy on resolved markets. The pool that subsidizes the market is the LP's commitment; the accuracy of the forecaster against the eventual resolution determines how the pool gets distributed at payout. Accurate calibration on a heavily-funded market pays more than accurate calibration on a thin one, mirroring real-economy outcome compensation.
- **Operators** pay both proposers and forecasters only in proportion to value delivered: the proposer is paid (via LP returns or via the optional `proposalReward`) only if the proposal moved the metric; forecasters are paid (via market payouts or via accuracy-weighted credit accumulation) only when their forecasts beat the consensus they helped form. The operator's spend on Telarchy is therefore a pure function of decision quality created, not a fixed cost.

This is a strictly better economic structure than seat-based SaaS, $/seat AI vendor licensing, or fixed-fee consulting. Each side is paid by the resolution of real KPI movement against real predictions; nobody is paid for activity in the absence of value created. The marketplace has built-in alignment: incentives flow to participants who reduce uncertainty about the operator's metrics, and they flow in proportion to how much uncertainty was reduced and how much that uncertainty mattered.

For the AI vendor world specifically, this is the substrate the industry is reaching for under the "outcome-based pricing" label. Telarchy provides the verifiable predictor that outcome contracts need; the same mechanism happens to also reward forecasters and proposers in the same outcome-aligned way.

## Scope

The primary use case is company governance: founders and leadership teams define their KPIs, OKRs, or any quantified business objectives and let the market forecast and evaluate decisions against them. The system also supports personal use (health, career, life metrics) and any other domain where a single owner defines the goals. Both are first-class from day one. Metrics are standalone by default; each can independently have time preference and prediction markets. Users can later connect metrics with formulas if they want derived values, but there is no required structure.

## Current stage and load-bearing uncertainties (2026-05-16)

Telarchy is a functional MVP, not a validated product. The infrastructure (LMSR markets, conditional markets, time preference, multi-workspace, real-money settlement, hooks, BetterAuth, `/marketplace`, `/leaderboard`, `/guides`) is complete and running on `telarchy.com`. There are zero real paying customers today. The founder uses the platform himself, partly to drive the product, partly because real first-customer validation has not happened yet. AI participants run, but their quality is weaker than the platform needs to be self-sustaining; automated LLM traders do not yet operate continuously.

Three things run concurrently in this phase:

1. **Potential-customer outreach.** Direct conversations with founders, operators, and investors to find the first real customer. The "founder concierge program" framing from earlier strategy notes is retired; in practice this is a reality-test motion, not a four-week verdict gate. Each conversation aims at: where is the most painful first entry, who is the first realistic buyer, what's the largest unstated assumption, what would falsify the wedge.
2. **Building the initial AI participant network.** Workspaces have to come with non-empty markets from minute one. This means seeded platform-operated participants whose forecast quality is good enough that an owner reading a price feels they are reading signal. Quality of the participant pool is currently the biggest product gap.
3. **Real-money settlement for AI participants, as fast as legal posture allows.** Real money turns Telarchy from a decision-support tool into an economic mechanism: forecasts get sharper because skin in the game is real, outcome contracts get a verifiable substrate, profitable AI bots can cover their own LLM costs (financially closed-loop autonomy), and the platform earns transaction-fee revenue proportional to decision throughput. The settlement infrastructure exists for self-hosted deployments today; turning it on for the managed instance is gated on legal posture.

Two uncertainties are load-bearing and have not yet been resolved by data:

- **Marketplace dynamics.** Companies need predictors of high enough quality that their pricing materially changes a decision; predictors need companies whose decisions are interesting enough to be worth forecasting. Either side without the other collapses the market. Mitigations in progress: one real workspace (the founder's own) seeds demand-side activity, and platform-built AI participants seed supply-side liquidity. Whether this is enough to bootstrap a self-sustaining network at single-digit cohort scale is an open question.
- **Metric-expressibility of company goals.** The mechanism assumes a company's ultimate objectives can be decomposed into a small set of measurable metrics well enough that forecasts on those metrics are a useful proxy for forecasts on the underlying objectives. If real companies turn out to have goals that fail to compose into a tractable metric set (because of softness, multi-stakeholder structure, or strategic ambiguity), the substrate stops being a useful decision aid for them regardless of how well the markets calibrate.

These two are the questions worth raising on every outreach conversation. Validation that the wedge holds depends more on these than on retention or DAU.

### Founder context

Solo technical founder. Previous shipped product: **LookPilot**, a software product that currently nets around 5,000 USD per month and provided global software-sales experience. AI tooling is part of the daily workflow; Telarchy's AI participants are being built in-house. The track record matters here because it sets a credible floor: this is not a first attempt at shipping software, but it is a deliberate move from a small-and-safe product to an ambitious one with much higher upside risk.

## Metrics vs Proposals

The distinction between metrics and proposals is foundational.

**Metrics** are definitional commitments. A metric declares that some quantity *certainly* matters in a known way. If you later find the metric was wrong (that you measured the wrong thing), that is a definition error, not a system failure, and the system cannot fix it for you. The practical implication: define metrics at the level of abstraction you are genuinely certain about, and keep them as subjective as necessary. A self-reported *Happiness* score is often a better leaf metric than *Dopamine level*, because the link between dopamine and subjective happiness is uncertain.

> **Example.** Suppose you define Happiness as dopamine level, then start taking drugs. Your dopamine metric rises; you are still unhappy. The system has done nothing wrong; it optimized exactly what you asked. The error was in the definition. The correct approach: keep *Happiness* as the metric (self-reported), and create a proposal (*"Will increasing dopamine improve my subjective happiness?"*) evaluated via conditional prediction markets before committing.

**Proposals** are hypothesis tests. Any time you are uncertain whether an action will improve a metric, that uncertainty belongs in a proposal, not in the metric definition. Conditional markets answer the question "what would metrics look like if this proposal were completed?" and the crowd's money resolves the uncertainty. This extends to metric structure itself: a participant can propose a proposal such as *"Create a new metric X and evaluate its relationship to our goals"*, letting the market judge whether adding that measurement will produce useful signal before the owner commits to a structural change.

### What makes a well-formed proposal: bound the action, price the outcome

A proposal is only useful if **its execution is near-certain and its outcome is uncertain.** The
market exists to price the second thing. Every unit of doubt about the first is doubt the market has
to price as well, and it cannot tell the owner which kind of doubt produced the number.

Three shapes fail, and they fail in increasing order of subtlety.

**1. The outcome dressed as a proposal.** *"Reach $1M ARR this year."* Nobody can decide to do this.
The conditional market ends up pricing the goal itself, which the owner already has a metric for, and
the proposal suggests no action to take or decline.

**2. The unbounded action.** *"Improve onboarding."* *"Do more sales outreach."* These are real
actions, but with no stated quantity. Two participants writing the same title mean different things,
the market prices an unknown amount of effort, and the owner cannot tell what they are approving.

**3. The action with doubtful execution.** *"Hire a senior infrastructure engineer this month."*
*"Sign a distribution partnership with a named vendor."* *"Close the Series A."* These are specific
and bounded, and they are still malformed, because **completing them requires someone else to say
yes.** A low price now means either "this would not help" or "this will not happen", and the owner
has no way to separate them. Worse, the proposer usually knows more about the second than the market
does, so the market is absorbing adverse selection rather than discovering a price.

**The fix is to bound the action by something the proposer controls.** Four bounds cover nearly
everything:

| Bound | Malformed | Well-formed |
|---|---|---|
| **Time** | Improve onboarding | Spend 20 engineering hours rewriting the onboarding flow |
| **Money** | Grow through paid acquisition | Spend $5,000 on one named channel over 30 days |
| **Count** | Talk to customers | Interview 20 churned customers |
| **Discrete act** | Fix pricing | Publish the new pricing page |

And the counterparty cases become tractable the moment they are bounded by effort rather than by
result:

| Instead of | Propose |
|---|---|
| Hire a senior infrastructure engineer | Run a two-week sourcing sprint and interview 10 candidates |
| Close the Series A | Send the deck to 30 investors and take every meeting offered |
| Sign the distribution partnership | Spend 15 hours preparing and pitching the named vendor |

Each of these the owner can guarantee to complete. Whether it produces a hire, a round, or a
partnership is exactly the uncertainty the market should be paid to price.

**The one-line test:** *at the moment of approval, could you commit to completing this action
regardless of how it turns out?* If yes, the proposal is well-formed. If completing it depends on
another party agreeing, on a skill you may not have, or on an amount of effort you have not named,
it is an outcome wearing an action's clothes.

**Why this is worth enforcing rather than leaving to taste.** A market on a doubtful action is a
market about a person, not about the business, and it corrupts three things at once: the price stops
being a forecast of impact, the decline record stops being readable (*"I never got round to it"*
becomes indistinguishable from *"the market was wrong"*), and liquidity is spent on a question the
owner could have answered for free. Bounded actions also make post-hoc evaluation honest, because a
completed action that failed is evidence, whereas an uncompleted one is nothing.

#### The strong form: approving should *be* the action

Bounding an action shrinks execution risk. **Writing the proposal so that pressing Approve is itself
the execution removes it entirely**, and that is the shape to reach for whenever it is available.

> The market should be pricing exactly one thing: **what happens if the owner presses Approve,
> against what happens if they press Decline.** Nothing should sit between the button and the world.

This is not a stylistic preference. It fixes both branches at once:

- **The approved branch** stops carrying follow-through risk, because there is no follow-through
  left. The price becomes a forecast about the world rather than a forecast about the owner.
- **The declined branch becomes a real counterfactual.** When approval is only an intention, decline
  does not mean the action will not happen, so `approved - declined` measures something muddier than
  the decision's effect. When approval *is* the act, decline genuinely means "this does not happen",
  which is what the conditional pair assumes.

**Write the title as what the button does.** If pressing Approve accomplishes nothing on its own, the
proposal is a note to self with a market attached.

| Approve does nothing yet | Approve *is* the action |
|---|---|
| Spend 20 engineering hours rewriting onboarding | Assign the onboarding rewrite to the team as this sprint's committed work |
| Grow through paid acquisition | Wire $5,000 to the named channel for a 30-day campaign |
| Fix pricing | Release the new pricing page to production |
| Get a vendor contract in place | Sign and return the $5,000 vendor contract |

**Only a mechanism makes approval self-executing. Everything else is a promise.** This distinction is
easy to blur and worth stating flatly: "pay the vendor" is not an approve-time act, because approving
is followed by opening a banking site. "Publish the post" is not one either. Each is *soon* after the
press, which is not the same as *at* it, and the gap is exactly where follow-through risk lives.

Approval executes only when something other than the owner's later attention carries it out:

1. **The platform moves the money.** Approving a paid job on a workspace that settles payments *is*
   the payment, because the system performs it. Nothing sits between the button and the transfer.
2. **A participant executes on approve.** With AI participants this is the end state: the proposer
   carries out the action, so the owner's press is the last human step and approval and execution
   are the same event by construction.
3. **An integration fires.** A deploy, a wire, a work order issued into a system that acts on it.

If none of these exists for a given workspace, **no wording makes approval self-executing**, and
pretending otherwise produces the worst kind of proposal: one that looks decisive and is a note to
self.

#### When there is no mechanism, propose the commitment

The right move is not to fake execution but to change what is being approved.

> **`Commit to X`.** Pressing Approve makes the commitment, and the commitment is the one thing a
> press can create with certainty. Whether it is honoured is then a real, priced uncertainty rather
> than an ambiguity sitting outside the market.

This does not eliminate follow-through risk. **It locates it.** The object being priced becomes
well-defined: a commitment, whose value already includes the probability that it is kept. Compare the
two failure states it replaces:

| Shape | What Approve guarantees | Where follow-through risk sits |
|---|---|---|
| `Improve onboarding` | Nothing | Nowhere. Unpriceable |
| `Ship the onboarding rewrite this sprint` | Nothing, but it reads as if it does | Hidden, and the price silently absorbs it |
| **`Commit to shipping the onboarding rewrite this sprint`** | **The commitment exists** | **Inside the price, by construction** |

Two things follow, and both are worth building for.

**Log the outcome on the proposal.** A commitment that is never resolved is back to being a note to
self. Recording *kept* or *failed* when the window closes is what makes the whole thing evidence.

**Repeated commitments calibrate the owner.** Once outcomes are logged, the market learns the
organisation's or the individual's actual keep-rate, and prices every subsequent commitment against
it. That number is genuinely new information: most owners have never measured what fraction of their
stated intentions they complete. A workspace can make it a metric in its own right.

**The honest limit.** Sustained behaviour change cannot be completed by a button and often cannot be
bought either. Converting it into a purchase is legitimate but produces a *different* action with a
different effect, so it should be chosen knowingly rather than reached for because it fits the
template.

## Multi-workspace and domain metrics

Telarchy workspaces are composable. A common pattern for individuals: one personal workspace defining personal goals, and one or more domain workspaces (a startup, a project, a team) with their own metrics. For a company, a single workspace usually holds the top-level KPIs and OKRs, with nested or linked workspaces for individual teams or products.

The connection between domain metrics and parent-level goals is often uncertain. How much does a startup's user count correspond to personal wealth? How much does a team's velocity contribute to company-level retention? These are empirical questions, not definitional ones, and they should not be hardwired into formulas. Instead:

- Treat the domain workspace as an information source. Participants observing both workspaces can use domain metrics as signal when proposing proposals and placing predictions in the parent workspace.
- Use proposals to test the connection. A proposal such as *"Will growing MAU by 20% improve our overall retention?"* lets conditional markets evaluate the hypothesis before you commit resources.

This keeps workspaces decoupled at the definition level while still allowing participants to reason across them.

**Why maintain a separate domain workspace at all?**

1. **Contextual information** - domain metrics (revenue, retention, velocity) give participants richer signal to reason about how to improve parent goals, without being hardcoded as direct formula inputs.
2. **Privacy** - a personal workspace may contain sensitive self-assessments; a company workspace may contain confidential revenue numbers. Each can have a different participant set without exposing the other's data.
3. **Multi-stakeholder** - multiple shareholders can co-own a workspace and independently evaluate its impact on their respective higher-level utilities. The exact coordination mechanism for this is an open design question.

Workspace settings include the display name, access level, and auto-funding of new non-proposal markets. Access is a single picker in Settings with three options: **Private** (invite-only), **Public** (listed on `/api/marketplace`, joiners view only), **Open** (listed, joiners can trade immediately). Under the hood this composes two primitives: `visibility` on the workspace (`public` / `private`; the `unlisted` value is kept in the schema for future use but no longer surfaced in the UI) and the Public permission group's `capabilities`. "Open" means `visibility=public` plus `['read','trade']` on the Public group; the picker adjusts both atomically so there is no separate backend field. Owners can still fine-tune the Public group's capabilities on the Participants page if they need something in between. **New workspaces default to Open** (no picker at creation) so first-time users land immediately on "participants can trade on my metrics"; a one-line notice on the welcome check-in page points to Settings for anyone who wants to change it. The backend default (`provisionWorkspace` with no `visibility` specified) remains `private`, which is the safer default for non-UI callers (self-hosted, API-only). Auto-funding is enabled by default on new workspaces (`DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5` per market), deducting from the workspace owner's balance. The browser client always talks to the deployment API (`VITE_API_URL` / hosted URL). Self-hosting remains a deploy-time concern, not a per-workspace redirect.

## Current State

### Onboarding templates (Implemented)

`POST /api/workspaces` accepts an optional `template` field (`startup`, `personal`, or `blank`) plus `templateParams`. Non-blank templates provision a small, opinionated set of leaf metrics with time preference enabled, each with a `marketRangeMax` matched to the metric's realistic bounds and sibling TP half-lives chosen to reflect each metric's timescale. Templates encode the `metric-design` guide principles directly (outcomes not activities, subjective self-reports over speculative proxies). Users edit freely after creation. Template definitions live in `functions/src/lib/templates.ts`; the `/create-workspace` UI picks a template before asking for a name.

### Phase 1: Participant Economy (Implemented)

Participants sign up either through browser accounts or direct API-key registration and then participate in a real-stakes economy.

- **Capabilities**: authorization is a flat set of three capabilities, `read` (view metrics/markets/proposals/sources), `trade` (place trades, propose proposals, send proposal messages), and `manage` (admin operations: create/edit metrics, resolve markets, approve proposals, manage groups and members). A caller's effective capabilities are the union of the `capabilities` arrays on every permission group they belong to in the active workspace. The master API key, the platform admin flag (`platformAdmin` in the DB, bootstrapped from `INITIAL_ADMIN_EMAIL`), and the workspace creator/owner short-circuit to all three capabilities. There are no fixed role enums at the auth layer; legacy labels like `admin`, `agent`, `member` are derived on the fly for UI display and are not authoritative.
- **Authentication**: three paths checked in order: master API key (`X-API-Key` header), BetterAuth browser-account session (cookie, resolved via `auth.api.getSession()`), per-participant API key (`X-Agent-Key`, SHA-256 hashed; header name kept for backwards compatibility). Google and GitHub OAuth are supported when `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` env vars are set. Browser accounts attach directly to a participant row in the `agents` table via `authUserId` (the table retains its original name). CORS and BetterAuth `trustedOrigins` come only from `ALLOWED_ORIGIN` / `TRUSTED_ORIGINS` (see `functions/src/lib/origins.ts`); `BETTER_AUTH_URL` is the public browser origin for OAuth redirects; optional `AUTH_COOKIE_DOMAIN` (e.g. `.example.com`) aligns cookies when apex and www both serve the app.
- **Identity symmetry**: human participants and AI participants are the same class of identity with different signup methods. A human-user login resolves to the same participant identity used by the corresponding API-key session, so trading, proposal, and workspace capabilities stay aligned.
- **Balance tracking**: `balance`, `earnedBetting`, `spentBetting`, `spentTokens` - separate counters for full auditability.
- **Credit economy**: Every participant receives `SIGNUP_CREDITS` credits on signup (per-instance env config, default 1000; telarchy.com runs the default, and a self-hosted instance may set 0 so that credits enter only through admin crediting or transfers). Credits are the core economy: workspace owners spend them to fund market liquidity; participants spend them to place predictions. On the managed instance (telarchy.com), credits are play-money with real scarcity. Platform admins can also distribute credits via `POST /agents/:id/credit`. On self-hosted instances with USDC settlement enabled, every credit is backed 1:1 by USDC held in the treasury, created only via `POST /agents/:id/deposit` (USDC -> credits, requires on-chain tx hash verification).
- **Global balance**: A participant's balance row in the `agents` table is not scoped to any workspace. Each participant has exactly one account with one credit balance usable across the system. **Balances are stored as integer nanocredits** (1 credit = 1,000,000,000 units) to eliminate IEEE 754 float drift. All reads go through `fromUnits()`, all writes use `toUnits()` before any SQL increment.
- **Admin UI**: Participants page with admin badge (rendered when a participant has the `manage` capability), credit distribution, PnL display. Administrative access is granted by adding a participant to the Admin system group (or any group whose capabilities include `manage`), not via a direct role dropdown.
- **Admin activity feed**: `GET /api/admin/activity` (manage capability required) returns a unified, workspace-scoped stream of trades, deposits, withdrawals, market creations/resolutions, metric updates, proposal activity, and liquidity events. Filterable by time range, type, participant, market, metric, or proposal. Polled with `nextCursor` for near-realtime observability of what every participant (human or bot) is doing.

### Phase 2: Prediction Layer (Implemented)

Participants forecast metric values, staking credits on their predictions.

- **Markets**: created by admin or auto-created from time-preference curves. Markets are also refreshed daily (00:10 UTC cron).
- **Date granularity**: markets support multiple target date formats: `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC).
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Formula Composition (Implemented)

Metric formulas use `{MetricName}` references plus standard math operators and helper functions such as `sqrt()`, `abs()`, `min()`, `max()`, and `pow()`. Forward-looking behavior is handled by the time-preference system, not by special formula syntax.

### Phase 4: Proposals and Conditional Decision Markets (Implemented)

Participants propose proposals; the system evaluates each proposal by running the existing prediction markets conditionally against it.

**How it works**:
1. A participant calls `POST /api/proposals` with `{ title, description }`.
2. When any participant fetches markets with `?proposalId=<id>`, the system auto-creates **dual-branch conditional markets**: for every active leaf-metric market, two clones spawn under the proposal, one with `branch="approved"` (priced under "what will metric X be if this proposal is approved?") and one with `branch="declined"` (priced under "what will metric X be if this proposal is declined?").
3. Participants forecast on both branches. The headline impact a human reads is `approved.consensus - declined.consensus` per metric, which isolates the causal effect of approving rather than the natural-trajectory baseline (which can itself price in expected approval, contaminating the comparison).
4. The admin (workspace owner or a participant with `manage` capability) views the proposal detail, which shows each metric's decline-counterfactual and approve-counterfactual side by side with the signed delta.
5. **Approve** - the declined-branch markets are voided and stakes refunded (the counterfactual never materialised); the approved-branch markets stay live and resolve against the actual metric value at the target date.
6. **Decline** (good faith) - mirror image of approve. The approved-branch markets are voided and refunded; the declined-branch markets stay live and resolve against actual metric, producing a counterfactual calibration record we can score the decision against later.
7. **Withdraw / decline as spam** - both branches voided, all stakes refunded.

A per-proposal message thread (`proposals/{proposalId}/messages`) enables proposer-admin negotiation before a decision is made.

Any participant with `manage` capability can also refresh conditional markets at any time to pick up newly created base markets.

### Phase 1b: Permission Groups (Implemented)

Per-workspace access control via a workspace-scoped `permissionGroups` table. Group names are labels ("nametags"); authorization is driven entirely by each group's `capabilities` array (a subset of `['read','trade','manage']`). A caller's effective capabilities are the union across every group they belong to.

- **Types**: `public`, `admin`, `trader`, `custom`. Type is purely a seeding hint; once created, every group's capabilities can be edited freely. System groups (`Public`, `Admin`, `Trader`) are bootstrapped on workspace creation with capability presets `['read']`, `['read','trade','manage']`, and `['read','trade']` respectively, and cannot be renamed or deleted (their capabilities can still be edited).
- **Unified access model**: Groups use canonical `memberIds[]` participant membership. Every route guard calls `requireCapability('read' | 'trade' | 'manage')` against the caller's unioned capability set; there are no hardcoded role checks. The master API key and the workspace creator/owner are granted all capabilities automatically.
- **Per-metric and per-source permissions**: groups additionally carry a `permissions` map (`metricId -> { read, trade }`) and a `sourcePermissions` map (`sourceId -> { read }`) for resource-level access. These gate specific metrics or sources for members of groups that include the corresponding workspace-level capability.
- **Workspace joining**: any authenticated participant can self-join a **public or unlisted** workspace via `POST /workspaces/:id/join` or `POST /marketplace/:workspaceId/join`, which adds them to the Public group (read-only by default). Admins then add the participant to the Trader or Admin group (or any custom group) to expand capabilities. Private workspaces cannot be self-joined (404, indistinguishable from a missing workspace, so the endpoint is not a probe for private ids); their members are added by an admin. Taking a workspace private also drops `trade` from its Public group, so trading rights granted while it was Open do not survive the change. **revised 2026-08-07**: visibility was previously not checked at all, which made a leaked workspace UUID sufficient to enter a private workspace.
- **API**: `GET /groups` (requires `read`), `POST /groups`, `PUT /groups/:id`, `DELETE /groups/:id` (all require `manage`). POST/PUT bodies accept a `capabilities: string[]` field.

### Public workspace identity and the charter (Implemented 2026-08-07)

A public workspace is only useful if a stranger who opens its link can tell what it governs and whether contributing is worth their time. Two fields on the workspace carry that, both nullable, both exposed only on public and unlisted workspaces:

- `description`: a one-line summary (<=280 chars), shown on the marketplace card and at the top of the public workspace page.
- `telarchyStartedOn`: the moment the owner says this workspace started running its number through Telarchy (nullable). The floor's actual-vs-forecast chart marks it with one dashed line, because a year of trajectory raises the question the number alone cannot answer: what changed, and when. Owner-declared rather than derived, since the honest date is neither the workspace's creation nor its first trade (LookPilot: created 8 August, first trade 11 August, started 13 August).
- `charter`: the owner's public commitment (<=20000 chars) about what they will actually do with the number the market produces, plus the reasons they may decline a winning proposal, declared in advance so they cannot be invented after the fact.

The charter is the load-bearing one, and it is a product claim, not decoration. An open workspace's credibility is not its metrics; it is whether the owner honours the result. Forecasters asked to price a stranger's decisions with no stated commitment are being asked for free labour, and they correctly refuse. Telarchy's answer is that every workspace inviting outside participants states, in public and in advance, what their work buys them. A charter that promises to disclose things is kept on the announcements surface below, which is why that surface is append-only.

`GET /api/marketplace/:workspaceId` serves this profile. The canonical page is the root-level **`telarchy.com/<slug>`** (trader-first flip, 2026-08-08): trading is the default thing the site does, so a workspace's root page IS the trading floor, not a teaser for an app. Logged out it is the poster; a signed-in visitor on an Open workspace is joined silently (membership is bookkeeping, not a decision) and the same page grows the controls: amount + Lower/Higher on the hero market, position with one-tap sell, an inline propose form, and per-branch trading in expanded ballot rows. Traders never leave this page for an app shell; the management console lives behind `/manage` (platform admins pass through to it, everyone else sees the owner waitlist). `/marketplace/:idOrSlug` keeps rendering the same page for already-shared links and canonicalizes to `/<slug>`. The API segment accepts the id or, for non-private workspaces, the slug; an ambiguous slug (same slug under two owners, both public) resolves to none rather than to a coin flip. The server also injects the workspace's name and description into the HTML head for this route (og:title, og:description, twitter card), because link scrapers do not run JavaScript and the unfurl card is the first impression most invitees get. Appending `?join=1` makes the page complete the join automatically once the visitor is signed in; the signup CTA uses it so click -> signup -> trading is one continuous flow with no second button press, landing on the ballot when proposals exist and on the markets tab otherwise. The disclosure line is **counts, not contents, except where membership is free**: for a workspace whose Public group grants `read` (an Open workspace), every visitor is one free self-join away from the contents, so hiding them behind signup is friction theater rather than privacy. The endpoint therefore ships the ballot for Open workspaces: pending proposals with their conditional-market deltas (approved minus declined consensus, the priced causal impact of approving) and the last 10 decisions with their published decline reasons, which is the charter's accountability on display. The page renders standalone as a poster (name, one-line description, the soonest market's consensus as a large instrument over its range, one CTA) with the ballot directly beneath the action. Workspaces whose Public group lacks `read` keep the counts-only boundary: metric names, market consensus, and counts are public; proposal text and chat require membership. Logged metric values and proposal chat require membership in every case.

### Workspace announcements (Implemented 2026-08-17)

A charter that promises "if something material happens that the market cannot see, I announce it within 24 hours" needs a place for the announcement to land. Until 2026-08-17 there was none. Comments hang off a market (`marketMessages`) or a proposal (`proposalMessages`), so there is always a thread to be buried in and never a workspace-level surface; `updates` is a metric-change record (`oldValue`/`newValue`/`description`), which is the wrong shape for prose. An owner with something to say to everyone had nowhere to say it, which made the one promise the charter leans hardest on unkeepable.

An **announcement** is owner-authored prose attached to a workspace: public, timestamped, ordered newest first. It is not a comment (nobody replies to it) and not a metric log (it carries no numbers).

- `announcements`: `id`, `workspaceId`, `body` (markdown, <=5000 chars), `publishedAt`, `editedAt` (null until edited), `originalBody` (null until edited, then the body exactly as first published).
- `POST /api/workspaces/:id/announcements` (`manage`) publishes one. `publishedAt` is set server-side and is never accepted from the client, because a disclosure timestamp the publisher can choose proves nothing.
- `PUT /api/workspaces/:id/announcements/:announcementId` (`manage`) edits one. An edit does not overwrite: the first edit copies the published body into `originalBody` and stamps `editedAt`, and both stay in the public payload from then on.
- `GET /api/marketplace/:workspaceId/announcements` (no auth) reads them, under the same public-payload privacy contract as the rest of the floor: private workspaces 403, and a workspace whose Public group lacks `read` keeps the counts-only boundary, exactly as `GET /api/marketplace/:workspaceId` already does. The workspace payload also carries `latestAnnouncement` and `announcementCount` inside that same `read` gate, so the floor's first paint needs no second request.

**Integrity is the point, not a nice-to-have.** The entire value of an announcement is that a trader can verify a disclosure happened before an event, so the record has to be one the owner cannot quietly rewrite afterwards. There is no delete route and no overwrite. Migration 0057 puts a database trigger on the table that refuses `DELETE` outright and refuses any `UPDATE` that re-dates `publishedAt`, changes the row's identity, drops or alters `originalBody`, or changes `body` without stamping `editedAt`. It is the same shape as the append-only ledgers of migration 0055, and it opts out the same way (`allowLedgerAdmin` for one transaction), which is what deleting an entire workspace uses. An announcement that can be silently rewritten is worth nothing to the promise it exists to keep, so a design where the owner can change history is a failed design, not a simpler one.

The public floor renders the latest announcement in the owner-prose zone (above "What is `<name>`?"), with the rest one click away, so a trader arriving mid-market sees the most recent disclosure without hunting for it.

### Per-market position cap (Implemented 2026-08-08)

`workspaces.maxPositionCostPerMarket` (credits, 0 = off, a `manage_workspace` setting) caps each participant's **cumulative buy cost per market, both directions summed**. Selling never refunds cap headroom, so churning cannot stretch it; sells themselves are always allowed.

This is the workspace's manipulation bound, and it exists because signup grants free credits to every account: without a cap, one person with a handful of email addresses can deploy enough into a single market to decide its outcome, and a public ship-what-the-market-says commitment becomes buyable. With the cap, moving a market far requires many distinct identities, which is exactly the coordination an owner can detect and, per their charter, void. The cap is deliberately public: `GET /api/marketplace/:workspaceId` carries it (with `signupCredits`) so the fairness rule is stated on the page a visitor decides on, not taken on faith.

**The charter is enforced, not decorative.** `proposals.declineReason` is required on `POST /api/proposals/:id/decline` exactly when the workspace has a charter set, and it is rendered permanently on the proposal. The coupling is the point: making the public commitment is what turns the requirement on. Requiring a reason everywhere would break existing clients and add friction to workspaces that promised nothing; requiring it nowhere leaves the one commitment the product sells unenforceable, and it degrades into a chat message nobody can find three months later. A workspace can therefore promise nothing and stay frictionless, or promise something and be held to it, but it cannot promise something and quietly skip the one decline that is embarrassing to explain.

### Sources (Implemented)

Workspace-scoped information stores with permission-group-based access control. A source has a `type` discriminator: `text` (free-form content stored on the source, e.g. credentials, API keys, context docs) or `github` (a live read-only bridge to a GitHub repo via OAuth + App installation tokens). Adding new source types (Slack, Notion, Postgres, ...) is a type-discriminator change rather than a new top-level concept. Admins create text sources directly or connect a GitHub repo through the OAuth flow; participants with read access can fetch text content or browse the repo tree and files. Permission groups control access via a `sourcePermissions` map (`sourceId -> { read: boolean }`). Any participant with the `manage` capability has implicit read access to all sources.

### Phase 5: Binary AMM (Implemented)

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule). Participants predict **higher** or **lower**, with no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0-1000) and stores `shares: [lowerShares, higherShares]`.
- Participants predict **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- Participants can also **sell** existing positions back to the AMM at current prices.
- **Consensus** = `rangeMin + p(higher) * (rangeMax - rangeMin)`, fed back into metric formulas.
- **At resolution**, payouts are **proportional**: if actual value V falls at fraction `p = (V - rangeMin) / (rangeMax - rangeMin)`, higher shares pay `p` credits each, lower shares pay `1 - p` credits each.

**LMSR mechanics**:
```
C(q) = b * ln(exp(q_lower / b) + exp(q_higher / b))
tradeCost = C(q_after) - C(q_before)
p(higher) = 1 / (1 + exp(-(q_higher - q_lower) / b))
```
`b` (liquidity parameter) controls price sensitivity. Any participant with the `trade` capability can inject liquidity into a market to enable or deepen trading, funded from their own balance, via `POST /predictions/markets/:id/liquidity`. It is a first-class trader action, not an admin-only one: providing liquidity is a genuine (refundable) LP position, not a donation. Funding another participant's balance, or bulk-funding many markets at once, still requires `manage`.

**LP accounting**: liquidity providers are charged only `poolIncrease` (what actually enters the pool), not the full liquidity parameter, which prevents ~30% overcharge on fresh markets. At resolution and void, any pool leftover is distributed back to LPs proportionally based on `poolContribution` recorded in `liquidityEvents`. Because that refund path runs at both real resolution and void, an injection is a real LP position: the injector recovers their stake minus whatever informed traders extracted from the pool.

**Key details**:
- `Market` stores: `rangeMin`, `rangeMax`, `shares: [lower, higher]`, `liquidity`
- `positions` track direction (`higher`/`lower`) + shares per agent per market
- `POST /predictions/trade` - two modes: `{direction, amount}` or `{value, amount}` (auto-picks direction based on which side the value falls)
- **UI**: probability slider per market, Higher/Lower buttons

### Phase 7: Time Preference System (Implemented)

Replaces `consensus()` formula calls with a per-node **time preference** property that automatically handles forward-looking evaluation and market creation.

**Core model**:
- `timePreference: { enabled: boolean, halfLife: number }` - **enabled by default** on new metrics (half-life 1 year). Without TP, a metric has no markets and cannot be tracked over time.
- When enabled, the node's value is a decay-weighted blend of: the current value (at t=0) plus market consensus values at 10 sampled future time points.
- **Formulas stay simple**: only `{MetricName}` references and math. No `consensus()` calls.
- **Sampling**: 10 quantile-midpoint samples from an exponential distribution with the given `halfLife` (in years). Each sample covers equal probability mass; weights are uniform. The median sample falls at `t = halfLife`.
- **Date granularity** of sampled time points adapts to distance: `YYYY-MM-DD` (< 1 week), `YYYY-Www` (< 1 month), `YYYY-MM` (< 1 year), `YYYY` (≥ 1 year).
- **Markets** are created only for leaf nodes (metrics with no formula), at the time points sampled by their ancestor's time-preference curve.

**Computation**:
```
value = sum(weight(t_i) * formula_eval_at_t_i) / sum(weight(t_i))
```
Non-leaf intermediate nodes in the subtree are evaluated deterministically from their formulas given predicted leaf values; no markets needed for them.

**Tree zone model**: when TP is on a computed metric, it divides the subtree into two zones:
- **Above the TP node**: purely compositional. These metrics combine TP-blended children via formulas and are forward-looking as a result. They don't interact with markets directly.
- **Below the TP node** (leaf metrics and intermediate computed metrics in the subtree): represent the *current state only*. Leaves are updated directly; computed nodes below TP evaluate deterministically from current values. The TP node above them handles all temporal expansion.

Any metric, leaf or computed, can have time preference enabled. A leaf with TP creates markets for itself and blends its current value with market consensus at future dates. A computed metric with TP creates markets for all its leaf descendants.

**Constraints**:
- **One time-preferenced node per path**: on any path through the metric graph, at most one node may have time preference enabled. Parent TP overrides children; enabling TP on a parent automatically removes TP from its descendants (with a warning). Enabling TP on a child when an ancestor already has TP is rejected.
- **Descendants describe current state**: all metrics below a time-preferenced node must represent the present; the TP node handles the forward-looking aspect for its entire subtree.

**Market lifecycle**:
- **Invariant**: a market may only exist while its metric's **definition** (name, description, formula, `marketRangeMax`) is unchanged from when the market was created. The set of valid statuses is:
  - **open**: trading allowed, will resolve on `targetDate`.
  - **closed** (`active: false`, not resolved, not voided): trading halted because the metric no longer references that `(metricId, targetDate)` pair (e.g. half-life change, or calendar time progressed past the sampled dates). The definition is still valid, so the market resolves normally on `targetDate` against the metric's live value. Existing positions are retained.
  - **resolved**: `targetDate` has passed, positions paid out against the metric's actual value.
  - **voided**: market was cancelled and every participant refunded **what they still had at stake in it**: the sum of their trades on that market (buys positive, sells negative), floored at zero. This is the only correct outcome whenever the metric's definition would change or disappear out from under a market.

    **Revised 2026-08-15 (Viktor), a void refunds net cash, not gross cost.** Until this date the refund was `positions.totalCost`, the cumulative BUY cost, which a sell never reduces (selling decrements `shares` only, on purpose, so churning cannot stretch the position cap). A participant who bought and sold the same shares back therefore had the whole buy cost handed to them again on the void: two 5-credit round trips on one market minted 10 credits, and repeating the trip before an expected void minted more. Refunding net cash closes that: a break-even round trip gets nothing back, someone still holding gets exactly what they still have in, and the floor at zero means a void never DEBITS anyone. A participant who sold out above their cost keeps that realised gain and receives no refund; the shortfall comes out of pool leftover before LPs, which is where market-maker risk belongs. The cap keeps reading gross `totalCost`, so this changes settlement only.
- **Closure happens when and only when** the trading window expires with the definition unchanged. Any edit that changes the definition (name, description, formula, `marketRangeMax`) voids all open markets for that metric and respawns fresh ones under the new definition. Deleting a metric voids all its open markets (refunds net cash, per the void rule above); descendant markets under a deleted non-leaf TP ancestor keep their own unchanged definitions and close naturally.
- The daily cron (00:10 UTC) and "Refresh Markets" button compute the desired `(leafId, targetDate)` set and create missing markets. Markets falling out of the desired set are set `active: false` (closed).
- A distributed refresh lock prevents duplicate creation from concurrent refresh calls.

**Examples**:
```
# Flat: TP directly on leaves
Revenue (leaf, TP: half-life=1y) ← markets for Revenue itself
NPS (leaf, TP: half-life=0.5y) ← markets for NPS itself

# Hierarchical: TP on computed nodes
Overall (formula: {Health} + {Career})
├── Health (TP: half-life=2y, formula: {Sleep} + {Exercise})
│   ├── Sleep (leaf) ← markets at sampled time points
│   └── Exercise (leaf) ← markets at sampled time points
└── Career (TP: half-life=5y, formula: {Income} + {Satisfaction})
    ├── Income (leaf) ← markets at sampled time points
    └── Satisfaction (leaf) ← markets at sampled time points
```

### Phase 8: USDC Settlement on Base (Implemented, opt-in)

On self-hosted instances with `USDC_SETTLEMENT_ENABLED=true`, credits are backed by real USDC. A treasury wallet on the Base L2 network holds the USDC reserve. Participants register a Base wallet address and can withdraw their credit balance as on-chain USDC at any time. On the managed instance (telarchy.com), USDC settlement is disabled and credits are play-money with no cash value.

**Settlement model**:
- Internal credit transfers (forecasting, proposal payouts, gifting) remain purely off-chain, with no gas fees.
- On-chain settlement only happens at withdrawal time, keeping fees negligible (~$0.001/tx on Base).
- Conversion rate: `creditValueUsd` from the `systemConfig` table (key: `economy`) determines how many USDC a credit is worth.

**API**:
- `PUT /api/agents/:id/wallet` - register or update a Base wallet address (self or admin).
- `POST /api/agents/:id/withdraw` - body `{ amount }`: deducts `amount` credits, sends `amount * creditValueUsd` USDC on-chain. Atomically re-credits on tx failure.
- `GET /api/agents/treasury` - admin only: returns treasury address and current USDC balance.

**Audit trail**: every withdrawal is recorded in the `withdrawals` table with `{ agentId, credits, usdcAmount, toAddress, txHash, createdAt }`.

**Credit purchase (open to anyone)**:
- Treasury receive address: `GET /api/agents/deposit-address` (no auth). Admins can also use `GET /api/agents/treasury` for the address plus live balances.
- Send USDC on Base to that address, then call `POST /api/agents/:id/deposit` with the tx hash.
- Backend verifies the transfer on-chain (reads the Transfer event, checks recipient = treasury).
- Credits issued: `floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100)))`.
- The fee surplus stays in the treasury. The system is self-sustaining: total USDC held ≥ credits outstanding × creditValueUsd at all times.
- Each tx hash is stored in the `deposits` table and rejected if reused (double-spend prevention).

**Web UI**: signed-in users get **Top up with USDC** from Account (balance area and sidebar); deposit panels render **`GET /api/guides/credits`** for prose and **`GET /api/agents/deposit-address`** for live contract/treasury values (same as any API client), plus the existing **`POST /api/agents/me/deposit`** form.

**Economy parameters** (stored in the `systemConfig` table, key: `economy`):
- `creditValueUsd` - USD value of 1 credit (also used for withdrawal conversion).
- `buyFeePercent` - fee percentage added on top when buying credits (default 0). E.g. 5 means 105 USDC -> 100 credits.

**Setup**: set `TREASURY_PRIVATE_KEY` (hex, `0x`-prefixed) and `USDC_SETTLEMENT_ENABLED=true` in server environment configuration. Without both, deposit/withdraw/wallet/treasury endpoints return 503. The managed instance runs with settlement disabled; self-hosted operators who enable it are responsible for their own regulatory compliance (see ToS section 6).

### Participant Economy Parameters (Implemented)

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the system economy configuration. Admins set this; participants use it to understand the real-money value of their balance.

**Credit model**: On the managed instance, credits are play-money distributed by admins. On USDC-enabled instances, 1 credit = `creditValueUsd` USD; total credits in circulation equal total USDC in the treasury divided by `creditValueUsd`. Internal flows (forecast wins/losses, proposal payouts, participant-to-participant transfers) are purely redistributive. Credits go down from inaccurate forecasts (automatic through AMM) and voluntary spending. Participants can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

### Hooks (Implemented)

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes automated participants when subscribed events occur. Config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) - the participant is woken on any event of that type, or
  - an **object** `{ type, metricNames?, metricIds? }` - filter by metric name/id.

### Metrics Graphing System (Implemented)

The Metrics tab uses a single Chart.js graph engine for both inline card charts and the expanded graph modal.

- **Shared renderer**: inline and modal charts rendered by the same `MetricsTimeChart` component.
- **Unified date model**: mixed target date formats normalized into canonical timestamps before plotting.
- **Axis behavior**: x-axis labels adaptive to visible time span, y-axis labels use deterministic numeric formatting.
- **Interaction**: inline charts support hover/click-to-expand; modal charts support tooltip inspection and x-axis pan/zoom.
- **Single realized-value history line**: the Graph modal draws one line, the metric's realized value over time. For leaves that is `value` (the user-authored "Now:" number); for composites `value` is always 0, so the line is sourced from the logged `outlook` (the computed formula result). The value/future-consensus blend is no longer drawn as a separate "outlook" line; market-informed future consensus is shown on demand via the "Show future predictions" toggle, which overlays the forward-dated `timeSeries` as a dashed forecast. Each `metric_logs` row still stores both `value` and `outlook`.

## Planned Phases

### Time Preference Future Extensions

- Additional curve types beyond exponential decay (e.g. control-point graphs for time-bounded goals like "have a kid" peaking at ages 28-35)
- Adaptive sampling: denser time points where the curve changes rapidly
- Visualization of the time-preference curve and its sampled points in the admin UI

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Admin UI   │────▶│  Express API     │────▶│   PostgreSQL     │
│  (React)     │     │  (Node.js)       │     │  (Drizzle ORM)   │
└─────────────┘     └──────────────────┘     │                  │
                           ▲                  │  agents          │
┌─────────────┐            │                  │  agentApiKeys    │
│ Automated    │───────────┘                  │  markets (AMM)   │
│ Participants │   X-Agent-Key auth           │  positions       │
└─────────────┘                               │  trades          │
                                              │  metrics         │
                                              │  metricLogs      │
                                              │  updates         │
                                              │  proposals           │
                                              │  workspaces      │
                                              │  permGroups      │
                                              └──────────────────┘

Managed (telarchy.com): Cloud Run + managed PostgreSQL (same code, different env)
Self-hosted: docker compose up (includes postgres service) or any Linux host + postgres
```

## Navigation

The app uses a persistent left sidebar (`Sidebar.tsx` + `AppLayout.tsx`) for all authenticated pages. The sidebar handles workspace switching (all workspaces listed, click to switch), workspace-scoped nav (Metrics, Markets, Proposals, Participants), platform nav (Marketplace, Account, Guides), and logout. The horizontal header (`Header.tsx`) is kept only for the API-key portal. `/account` shows the signed-in participant identity and balance, and links to the API-key portal for direct API access when needed.

`/marketplace` is both a discovery surface and a trading surface: anonymous visitors can browse public markets, while signed-in users can see the active markets from workspaces they belong to and trade on them directly as their authenticated participant identity. Marketplace lists are ordered by actual resolution date (not by liquidity), and each card preserves the original granularity label (`month`, `week`, etc.) while also showing the exact UTC resolution timestamp.

`/guides` is a publicly accessible in-app reference covering metric structure, formula syntax, time preference, markets, and the proposal decision loop. No auth required.

The selected workspace now owns its workspace-scoped links directly in the sidebar. Metrics, Markets, Proposals, Participants, and workspace Settings render as a collapsible nested subsection under the active workspace rather than as a separate top-level "Workspace" section, which keeps workspace context and page context aligned.

## Design Principles

1. **Simplicity first** - each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** - metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** - all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** - the market/position separation and the time-preference architecture keep future mechanism changes (e.g. cPMM, order books, new curve families) clean.
5. **Capitalism for alignment** - the economic incentives align participant behavior with improving the metrics you care about.
6. **Static definitions** - formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely; this is what participants forecast.
7. **Metrics as commitments, proposals as hypotheses** - a metric expresses what you are already certain affects your utility, at the level of abstraction you are certain about. If you are unsure whether a proxy truly maps to your goal, that uncertainty belongs in a proposal (with conditional markets to test it), not in the metric definition. The system optimizes exactly what you measure; defining the wrong metric is the user's responsibility. Prefer subjective, high-level definitions (e.g. *Happiness* as a self-reported score) over over-specified proxies (e.g. dopamine level). Proxies belong in proposals.

## Business Model

**Today: managed hosted service.** The only way to use Telarchy today is `telarchy.com`. The repo is private and there is no published self-hosting image. The free managed tier is the distribution channel while we grow the participant network.

**Planned direction: open core.** Once the managed network's participant reputation is a real moat (i.e. once copying the code doesn't let a fork instantly recreate the network), the intent is to MIT-license the backend and frontend and publish a self-hosting Docker image. Not available today; do not promise this externally until the repo is actually public and a `LICENSE` file is committed.

**The moat is the participant network, not the software.** Participants accumulate trading history, calibration scores, and reputation over time. These are network effects that cannot be cloned from source code. The intended revenue model is built around access to this network:

- **Free managed tier** - workspaces hosted on the central platform, access to the shared participant pool; free to drive adoption and grow the network flywheel.
- **Network federation (paid, future)** - once self-hosting exists, self-hosted instances that want to use the central participant pool would pay a federation fee; without federation their participants would be fully local and isolated. Federation pricing would reflect API calls to the shared economy, not hosting costs.
- **Enterprise** - SLA, DPA, dedicated support, integration depth; not competing on hosting price but on accountability.
- **Transaction fees** - a percentage fee on trades (configurable via `buyFeePercent`), applied as a supplementary revenue stream.

## Infrastructure

**Database**: PostgreSQL with Drizzle ORM (single schema, no Firestore dependency). Both managed and self-hosted deployments use the same stack. The Docker image bundles the frontend and backend, and a PostgreSQL service is provided via `docker-compose.yml`.

**Authentication**: BetterAuth replaces Firebase Auth. Email/password is always available; Google and GitHub OAuth are opt-in via environment variables. Sessions are cookie-based (works cross-origin with `credentials: 'include'`). There is no hostname baked into the server: set `ALLOWED_ORIGIN` (comma-separated or `*`), `BETTER_AUTH_URL`, and when needed `AUTH_COOKIE_DOMAIN` / `TRUSTED_ORIGINS` the same way on Docker, Firebase (via `functions/.env` loaded at deploy), or any host. Managed and self-hosted use the same Express app and env contract.

**Self-hosting**: `docker compose up` spins up a complete instance (backend + frontend + PostgreSQL) with no external dependencies. Run `npm run db:migrate` (in `functions/`) once after first boot to create the schema. Cron jobs must be triggered externally (see `.env.example`).

## Tests

The test suite lives alongside the code it exercises. Tests serve as executable documentation; they define expected behavior and catch regressions.

**Unit tests** (`functions/src/__tests__/`):
| File | What it covers |
|---|---|
| `amm.test.ts` | LMSR AMM math: cost, probability, consensus, trade cost, payouts |
| `metrics-engine.test.ts` | Formula evaluation, circular-dep detection, topo sort, recalculation, propagation |
| `date-utils.test.ts` | Date parsing, granularity detection, relative-to-absolute conversion, `endOfPeriod` |
| `validation.test.ts` | `validateAgentId`, `validateContent`, `validateTxHash` |

Run with `npm test` (in `functions/`) or `npm test` from the repo root.

**Integration tests** (`scripts/test-integration.ts`):

End-to-end test suite that hits the live API. Covers: health, workspaces, agents, admin credit, metrics (CRUD, formulas, circular deps), prediction markets (create, refresh, liquidity injection, market fields), trading (buy, sell, balance tracking, error cases), proposals (propose, approve, decline), permission groups, workspace isolation (cross-tenant data separation), events, and auth.

Run against a local instance:
```bash
BASE_URL=http://localhost:8080 API_KEY=<master-key> node scripts/test-integration.ts
```
Or via npm: `npm run test:integration` (set env vars first).

The integration tests create their own workspace and data, and clean up after themselves. They are designed to pass on a fresh instance and to be extended by adding new `test()` calls in the appropriate `suite()` block.


**DONE 2026-08-10 (Viktor): the alpha wall.** Until the management console
leaves alpha, the only public surface is the trading floor: telarchy.com
redirects to /lookpilot, and every other route (landing, app shell,
console, account settings, admin) renders only for a signed-in PLATFORM
ADMIN (tightened 2026-08-11 from the earlier visit-/alpha-once
localStorage curtain: the old UI is invisible to everyone else, flag or
no flag). Hidden pages additionally enforce their own auth server-side. Public doors that remain: /login, /signup,
/waitlist, legal pages, and the floors themselves. Anyone wanting to run
their own company or goal this way is pointed at the email door in the
floor's about section.
