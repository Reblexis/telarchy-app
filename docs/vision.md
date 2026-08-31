# Telarchy

## Mission and vision

**Slogan: "Approve on evidence, not on who argued best. See what each proposal does to your KPIs before you say yes."** The mission line, "the alignment layer for AI and humans", is the zoom-out framing below, not the customer-facing tagline.

History: notes/decisions/vision.md.

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

Both sides run on the same prediction-market infrastructure: LMSR markets per metric, conditional markets per proposal, per-metric privacy controls, time-preference horizons, real-money settlement (see Phase 8). The headline use case for the owner side is company governance; the headline use case for the forecaster side is portable AI calibration that pays.

### Trader-first sequencing

A two-sided marketplace is bootstrapped one side at a time, and Telarchy solves the **trader side first**. The product IS the trader experience:

- **Every account is a trader by default.** Signup lands in the trading surface with the signup grant; there is no intent picker and no owner onboarding in the product.
- **Workspace creation is open at the API, and publishing is one gated step.** `POST /api/workspaces` is open to any identity: a browser session or a participant key, no invite. One brake applies to callers who are not platform admins: three workspaces per account. A new floor defaults to `unlisted`: visible to its owner (first in the home grid, badged "Yours · not public yet"), live and tradeable at its link, and one Publish button away from the telarchy.com list. The flip to `public` is refused while the floor has no metric (owner asks 2026-08-28: a visible publish button, and at least one metric to be publishable), because an empty shopfront on the front list serves nobody; an explicit visibility at creation is honoured for API and template callers. ACCEPTED RISK, stated so it is not forgotten: a running prize season scores over every public workspace (`docs/seasons.md`), so self-serve publishing lets someone open a floor, subsidise it out of signup grants and extract that subsidy into an entered account; the metric gate raises the effort without closing the hole, knowingly, while Telarchy is small enough to watch by hand. `POST /api/onboard`, the unauthenticated one-call variant, is paused: it mints an identity and a workspace together, so there is no account for the cap to count.
- **`/manage` is a door to a conversation, not a creation wizard.** It is the owner side's surface, and the whole of it is Otto: he interviews the visitor, makes the setup decisions as them, and hands them a prompt their own agent can run. The decisions he covers are the governing list in `functions/src/lib/setup-spec.ts`, their state is read from rows (`GET /api/setup/checklist`), and the path ends on a live floor rather than on a settings page. There is no form and no waitlist box under him: every field a form could ask for (which number, what ceiling, what horizon) is a question Telarchy answers better than a stranger on their first minute, and a form cannot argue with the answer. Anyone who wants a human has `/contact`. What Telarchy offers an operator, and what setting one up consists of, is the operator-door design note (private notes); the screen follows that answer, not the other way round.
- **There is no app shell.** Every page is standalone (see "Navigation"); workspace administration lives in the API.

The mission (alignment layer for AI and humans) and the owner-side positioning are unchanged by this order; it is go-to-market order, not a product redefinition. Rationale: with zero external users, the scarce resource is a stranger's first minute, and the only first minute on offer is trading a real company's roadmap.

**The owner side is open.** An owner who wants in gets in without a human doing it by hand once three things exist:

1. **A workspace can be created by the person who wants one.** The API creates workspaces (`createWorkspaceFromTemplate`) and the permission is open (above); the surface is the missing half. The owner path is: name the number, say where its value comes from, and land on the floor for it. It ends on a live floor, never on a settings page.
2. **The owner decides where the liquidity goes.** The primitives exist and the steering does not. A workspace has one blunt auto-fund setting (`autoFundNewMarkets` x `newMarketLiquidityCredits`, applied uniformly to every new market), and funding a specific market is possible (`POST /api/predictions/markets/:id/liquidity`, and the admin bulk form) but has no owner-facing surface. What is missing is the allocation view: what each market holds, and the ability to move credits onto the decision that matters this week and off the ones that do not. Liquidity is the owner's steering wheel (see "Decision quality scales with capital"): a pool is how an owner says which question is worth answering well, so leaving it as one global number per workspace throws away the signal.
3. **Liquidity can be bought; credits cannot, ever.** Resolved 2026-08-28: the purchasable thing is market liquidity (Stripe Checkout, `POST /api/workspaces/:id/liquidity/checkout`, pool-only, docs/liquidity-purchases.md), which gives Telarchy its revenue line without a per-credit price, and per-credit purchase stays out permanently because a credit price makes every market a real-money bet (the legality analysis in the telarchy umbrella, notes/wheel-vs-proportional-legality-2026-08-28.md). The paragraph below records the pre-resolution state. This was the one that is not a UI problem. The USDC deposit path is implemented but the managed instance runs with settlement disabled (`GET /api/agents/deposit-address` returns 503) and managed credits are admin-granted play money, so an operator willing to pay cannot. Until this exists Telarchy cannot charge anyone for anything, and every pricing conversation is theoretical. It is legal-gated (see ToS section 6); the interim is an invoice-plus-admin-grant path run by a human, documented rather than improvised.

Sequencing: (1) is the only one that blocks a waiting operator, and it is a permission plus one screen. (2) is what makes an operator's second week worth anything, because without it their liquidity sits spread evenly across markets they do not care about. (3) cannot be first however much it matters.

Trader-first is not reversed by the owner side being open. Every account is still a trader by default and signup still lands in the trading surface; wanting to own a floor is not a request submitted to a waitlist.

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

**Automation is a continuum, not a switch.** At the near end the market informs a human who decides; the human is faster and better-calibrated than they would be without it. As markets accumulate data and calibration improves, more decisions can clear without a human in the loop at all. The direction is an asymptote: less time spent deciding, more spent doing. The product delivers value at every point on the continuum, not only at the far end.

## Telarchy as an alignment layer for AI and humans

The post-AGI division of labor: humans say what they want; everything else is automated. Defining what you want, clearly enough that a system can pursue it, is one of the last jobs that doesn't go away short of brain-computer interfaces reading intent directly. Telarchy is a system designed for exactly that division of labor, and the same mechanism applies whether the proposer is an AI or a human teammate:

1. **Owner defines metrics**. The things they want, the structure that connects them, the time horizon they care about.
2. **Participants propose actions**. AI agents register via API key and propose proposals (`POST /api/proposals`); human teammates do the same through the UI. Either can put any decision on the table.
3. **Markets price the actions against the metrics**. Conditional markets compute the expected impact of each proposed action on every metric. Forecasters (human or AI) with skin in the game produce calibrated estimates.
4. **Owner approves with calibrated confidence**. The owner sees a number, not a pitch. The decision proceeds with the market's predicted impact attached, not with whoever argued loudest.
5. **Whoever owns the action executes**; metrics update over time, feeding back into the next round.

This is structurally an alignment mechanism. No participant (AI or human) gets a proposal approved unless the market predicts it will improve the owner-defined metrics. The market is the filter; accuracy pays out, bias loses money, and every decision is auditable in `/admin` via the open agent telemetry protocol (`docs/agent-telemetry-protocol.md`).

This matters because the realistic alternatives a founder reaches for both fail in the same way. For AI proposals, the default is a generic chatbot, which has no skin in the game and no goal context. For human proposals, the default is a gut call or whoever argues loudest in the room. Both produce the same biased forecasts as the proposer pitching their own project. As AI agents take over more of the operational work in companies, the bottleneck collapses to: who decides what to actually do? Telarchy's answer is "the owner, on a market-priced forecast", regardless of who proposed the action.

### Why now

Two compounding facts make this the right moment:

- **Intelligence is the cheapest it has ever been.** Prediction markets thrive in cheap intelligence: every proposal can now be evaluated by many forecasters at near-zero per-forecast cost. The thing that limited internal prediction markets historically (you needed dozens of motivated human forecasters per market) is gone.
- **AI participants grant privacy that human forecasters cannot.** This is structurally new. Internal prediction markets have existed since the 1990s (HP, Google's Prophit, etc.) and have always worked mathematically. They never crossed into the decisions founders actually want priced because human bettors carry information out: a teammate who sees a sensitive KPI goes home with it, changes jobs with it, talks about it; you cannot unlearn a sensitive KPI. AI participants are the first bettor type that can be hosted on infrastructure the owner trusts (or run locally) with memory wiped between sessions, so a confidential metric can be priced without anyone carrying the information out. Telarchy makes this operational with per-metric privacy controls (workspace permission groups carry separate read and trade rights per-metric and per-source), so the owner can expose exactly the slice each participant needs and nothing more. This unlocks pricing for the decisions that previously had no realistic forum: confidential KPIs, unannounced strategic moves, sensitive people decisions.

This framing is load-bearing for positioning, not a tagline. The mechanism (conditional markets + composed metrics + time preference + first-class AI and human participants + open audit) is what makes the alignment-layer story credible. Without those pieces it would be marketing; with them, it is a real control surface for any decision in a business.

### Choosable privacy: per-workspace, per-metric, per-source

Privacy in Telarchy is not a pricing tier or a deployment mode you commit to up front. It is a continuous setting that lives on three levels, and every one of them is the owner's to choose and to change at any time. This is what turns the "why now" privacy-unlock argument above into an actual product feature, and it is one of the main reasons an owner can put a decision they would never expose to human teammates in front of the market.

1. **Per-workspace.** Three access levels: **Private** (invite-only, not listed anywhere), **Public** (listed on `/api/marketplace`, joiners can view but not trade), and **Open** (listed, joiners can trade immediately). Each is a composition of workspace `visibility` with the Public permission group's capabilities, set through `PUT /api/workspaces/:id/settings` and `PUT /api/groups/:id`; there is no browser screen for it. New workspaces created by a non-admin identity default to Unlisted (live, joinable and tradeable by link, not listed; `public` is clamped to `unlisted` at creation, see the self-serve brakes above), while the backend default for API-only and self-hosted callers (`provisionWorkspace` with no `visibility`) is the safer Private.
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

This unlocks a category that does not exist anywhere else:

- **For AI labs:** a public, auditable, dollar-denominated benchmark that does not saturate as quickly as capability benchmarks (because the population of forecasters competes adversarially; each model's edge erodes as others learn). Once real-money settlement is on, the benchmark pays out in real money and provides a path to direct revenue from forecasting capability that is independent of seat-based licensing.
- **For autonomous-agent builders:** a substrate where a profitable bot is financially closed-loop. A correct-enough forecaster earns enough at resolution to cover its own LLM and compute costs. Autonomy plus economic sustainability without external funding.
- **For the alignment / AI-safety community:** the first benchmark where "this model is more useful" and "this model creates more value" are operationally equivalent. Models that produce noise lose money and influence; models that produce calibrated forecasts gain weight in future markets, by mechanism, not by curation.

The implications for Telarchy positioning: the participant network is not just a moat (existing accumulated reputation), it is also a market. AI labs publish models as Telarchy participants; the labs that make the most money are also the ones whose models actually create economic value. The benchmark and the marketplace are the same surface.

### Decision quality scales with capital

The LMSR mechanism has graceful, logarithmic diminishing returns to liquidity: each marginal credit added to a market still buys real forecast sharpness, just less than the one before. Combined with the practical dynamic that bigger pools attract more and better forecasters (because the expected value of trading scales with pool size), the practical scaling is even gentler than the math alone suggests. There is no architectural ceiling: unlike user-count-bounded SaaS economics, where the marginal user eventually saturates the market, the marginal credit poured into a Telarchy market still buys value far longer.

This scaling property is conditional on a deep enough participant pool to absorb the capital. With a thin pool (a workspace's first weeks, or a brand-new specialty market with few experienced forecasters), additional liquidity primarily increases LP exposure rather than buying sharpness, because the same small set of traders captures the marginal pool. The pitch is "scales gracefully with capital once a participant pool exists", not "any amount of capital instantly buys decision quality." The participant network is what makes capital scaling real; without it, capital is just LP subsidy to whoever happens to be trading.

This expresses itself in three places that operators and traders care about directly:

1. **Per-market sharpness.** Price sensitivity is `b = pool / ln(2)`. A bigger pool means a more sensitive price surface, so more forecasters find tradable edges, so more information enters the consensus. The expected loss to the LP is bounded at `b * ln(2)` (= the pool itself), which is paid only when the market consensus is wrong; on average, an LP recovers most of the pool through correct payouts and the cost works out as a deliberate subsidy to information.

2. **Per-workspace prioritization by liquidity.** Owners allocate liquidity by importance. Metrics the owner cares about most get rich pools (`autoFundNewMarkets` plus targeted `POST /predictions/markets/:id/liquidity` injections), pulling tight forecasts. Less critical metrics get smaller pools and looser consensus. Priorities become a continuous knob, not a binary "track or do not track" choice. The pool you put on a metric is itself a legible signal of how much you care.

**A conditional market is never born dead if anyone can pay.** A proposal may name no `liquiditySubsidy`, and a market at zero liquidity has no price at all: it charts as nothing and the server refuses every trade against it, so a public floor would show jobs whose only response to a visitor is a refusal. Funding therefore falls through: the proposal's named contributors first, then the workspace's own auto-fund setting (`autoFundNewMarkets` x `newMarketLiquidityCredits`, debited from the workspace owner exactly as baseline markets are), and if the owner cannot cover the full amount, **whatever they can cover**, down to one nanocredit per market. A thin market is a market; all-or-nothing funding leaves untradeable jobs on a floor whose owner holds less than the ask. Only when nobody can pay anything do the markets spawn unfunded, and the floor then says so in place of the bet buttons rather than offering a bet the server must reject.

3. **Per-proposal conviction-weighted influence.** A trader confident in a conditional forecast can fund that market more heavily via `liquiditySubsidy` on `POST /api/proposals`, or via `POST /predictions/markets/:id/liquidity` on the specific market (any participant with the `trade` capability, funded from their own balance); admins can bulk-fund every market under a proposal via `POST /predictions/markets/liquidity/bulk`. Their conviction translates to influence in two ways: the trader's own position size, plus the LP subsidy that pulls other forecasters in to compete on the now-more-tradable market. High-conviction calls become high-signal markets, which is precisely the right thing.

The pair to the AI-progress-compounding argument: AI progress makes forecaster *quality* approach free; capital scaling makes forecaster *attention* allocatable to anywhere the operator or trader wants it. Decision quality scales on two independent axes, both gracefully, both without ceiling. The bottleneck is neither AI capability (which keeps getting cheaper) nor user count (which Telarchy does not depend on linearly); the bottleneck is willingness to allocate, and that is exactly where the operator's prioritization signal lives.

For investor framing: this is a strictly better growth model than user-count-driven SaaS. Telarchy's effective output (decision quality, calibration, real economic value created) keeps responding to capital injection long after a SaaS would have saturated. Combined with the participant-network moat (calibration history that source code cannot clone) and the AI-economic-capability-benchmark frame (where every dollar of liquidity converts directly to a dollar-denominated benchmark surface for the AI ecosystem), the marginal-credit math compounds favourably across all three positioning axes.

### Outcome-based pricing on both sides of the marketplace

The same mechanism that makes the system scale with capital also aligns economic motivation across all three roles in a Telarchy workspace. Telarchy is, structurally, outcome-based pricing on both sides of a marketplace, with the operator buying value in the middle. The unit (play-money credits on telarchy.com, real-money settlement on self-hosted with settlement enabled) changes without changing the alignment property.

- **Proposers.** A proposer's subsidy is a refundable LP position; on approve the owner takes it over at cost, on decline it rides the declined branch to resolution. A proposer who believes their proposal will move a metric dramatically can fund the conditional markets heavily to draw forecasters in, and takes a position on the approved branch to be paid for being right: if the metric moves as predicted the position pays in proportion; if the proposal turns out to be a wash it barely moves either way. Big predicted impact + correct prediction = big earnings. Big predicted impact + wrong prediction = big losses. The economics push proposers toward finding genuinely high-leverage actions, not just any action.
- **Forecasters** earn payouts proportional to forecast accuracy on resolved markets. The pool that subsidizes the market is the LP's commitment; the accuracy of the forecaster against the eventual resolution determines how the pool gets distributed at payout. Accurate calibration on a heavily-funded market pays more than accurate calibration on a thin one, mirroring real-economy outcome compensation.
- **Operators** pay both proposers and forecasters only in proportion to value delivered: the proposer is paid the optional `proposalReward` on approval, and only a position they take on the approved branch pays in proportion to how the metric actually moves; forecasters are paid (via market payouts or via accuracy-weighted credit accumulation) only when their forecasts beat the consensus they helped form. The operator's spend on Telarchy is therefore a pure function of decision quality created, not a fixed cost.

This is a strictly better economic structure than seat-based SaaS, $/seat AI vendor licensing, or fixed-fee consulting. Each side is paid by the resolution of real KPI movement against real predictions; nobody is paid for activity in the absence of value created. The marketplace has built-in alignment: incentives flow to participants who reduce uncertainty about the operator's metrics, and they flow in proportion to how much uncertainty was reduced and how much that uncertainty mattered.

For the AI vendor world specifically, this is the substrate the industry is reaching for under the "outcome-based pricing" label. Telarchy provides the verifiable predictor that outcome contracts need; the same mechanism happens to also reward forecasters and proposers in the same outcome-aligned way.

## Scope

The primary use case is company governance: founders and leadership teams define their KPIs, OKRs, or any quantified business objectives and let the market forecast and evaluate decisions against them. The system also supports personal use (health, career, life metrics) and any other domain where a single owner defines the goals. Both are first-class from day one. Metrics are standalone by default; each can independently have time preference and prediction markets. Users can later connect metrics with formulas if they want derived values, but there is no required structure.

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

1. **Approval is the payment.** Approving a paid contract is the payment event: at the press the
   agreed amount is owed and the contract counts as paid (it is what `approvedUsd` sums, and nothing
   sits between the button and that record). Whatever rail carries the dollars afterwards, the owner's
   bank transfer included, is settlement of a debt already incurred, not a second decision.
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

Workspace settings include the display name, access level, and auto-funding of new non-proposal markets, all written through `PUT /api/workspaces/:id/settings`. Access has three levels: **Private** (invite-only), **Public** (listed on `/api/marketplace`, joiners view only), **Open** (listed, joiners can trade immediately). Each composes two primitives: `visibility` on the workspace (`public` / `unlisted` / `private`) and the Public permission group's `capabilities`. "Open" means `visibility=public` plus `['read','trade']` on the Public group; there is no separate backend field, and an owner who wants something in between edits the Public group's capabilities directly with `PUT /api/groups/:id`. **New workspaces created by a non-admin identity default to Unlisted** (`public` is clamped to `unlisted` at creation), live and joinable by link until a human lists them. The backend default (`provisionWorkspace` with no `visibility` specified) remains `private`, which is the safer default for non-UI callers (self-hosted, API-only). Auto-funding is enabled by default on new workspaces (`DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5` per market), deducting from the workspace owner's balance. The browser client always talks to the deployment API (`VITE_API_URL` / hosted URL). Self-hosting remains a deploy-time concern, not a per-workspace redirect.

## Current State

### Onboarding templates

`POST /api/workspaces` accepts an optional `template` field (`startup`, `personal`, or `blank`) plus `templateParams`. Non-blank templates provision a small, opinionated set of leaf metrics with time preference enabled, each with a `marketRangeMax` matched to the metric's realistic bounds and sibling TP half-lives chosen to reflect each metric's timescale. Templates encode the `metric-design` guide principles directly (outcomes not activities, subjective self-reports over speculative proxies). Users edit freely after creation. Template definitions live in `functions/src/lib/templates.ts`; a template is named on the `POST /api/workspaces` call. The setup conversation at `/manage` does not use them: it opens a blank floor and builds the metric with the operator instead, because a template cannot know which number this operator actually reads.

### Phase 1: Participant Economy

Participants sign up either through browser accounts or direct API-key registration and then participate in a real-stakes economy.

- **Capabilities**: authorization is a flat set of four capabilities: `read` (view metrics/markets/proposals/sources), `trade` (place trades, propose proposals, send proposal messages), `manage` (admin operations: create/edit metrics, resolve markets, approve proposals, manage groups and members), and `manage_workspace` (lifecycle: delete the workspace, change visibility, configure auto-fund and default liquidity; not implied by `manage`). A caller's effective capabilities are the union of the `capabilities` arrays on every permission group they belong to in the active workspace. The master API key, the platform admin flag (`platformAdmin` in the DB, bootstrapped from `INITIAL_ADMIN_EMAIL`), and the workspace creator/owner short-circuit to all four capabilities. There are no fixed role enums at the auth layer; legacy labels like `admin`, `agent`, `member` are derived on the fly for UI display and are not authoritative.
- **Authentication**: three paths checked in order: master API key (`X-API-Key` header), BetterAuth browser-account session (cookie, resolved via `auth.api.getSession()`), per-participant API key (`X-Agent-Key`, SHA-256 hashed; header name kept for backwards compatibility). Google and GitHub OAuth are supported when `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` env vars are set. Browser accounts attach directly to a participant row in the `agents` table via `authUserId` (the table retains its original name). CORS and BetterAuth `trustedOrigins` come only from `ALLOWED_ORIGIN` / `TRUSTED_ORIGINS` (see `functions/src/lib/origins.ts`); `BETTER_AUTH_URL` is the public browser origin for OAuth redirects; optional `AUTH_COOKIE_DOMAIN` (e.g. `.example.com`) aligns cookies when apex and www both serve the app.
- **Identity symmetry**: human participants and AI participants are the same class of identity with different signup methods. A human-user login resolves to the same participant identity used by the corresponding API-key session, so trading, proposal, and workspace capabilities stay aligned.
- **Balance tracking**: `balance`, `earnedBetting`, `spentBetting`, `spentTokens` - separate counters for full auditability.
- **Credit economy**: Grants are priced at what the account verifiably brings, in the earn table (`earn_rules`), which the operator edits live and publishes at `GET /api/earn`; no grant is a constant in prose. A browser signup is priced by the provider it came through, an API-registered participant is priced at nothing and trades on credits its owner transfers to it, and a linked Manifold record earns a flat grant for a qualified account rather than anything scaled by its mana. The env constants (`SIGNUP_CREDITS`, `AGENT_SIGNUP_CREDITS`) remain the fallback for an instance whose table was never seeded, and a self-hosted instance may set them to 0 so that credits enter only through admin crediting or transfers. Detail: `docs/agent-economy.md`. Credits are the core economy: workspace owners spend them to fund market liquidity; participants spend them to place predictions. On the managed instance (telarchy.com), credits are play-money with real scarcity. Platform admins can also distribute credits via `POST /agents/:id/credit`. On self-hosted instances with USDC settlement enabled, every credit is backed 1:1 by USDC held in the treasury, created only via `POST /agents/:id/deposit` (USDC -> credits, requires on-chain tx hash verification).
- **Global balance**: A participant's balance row in the `agents` table is not scoped to any workspace. Each participant has exactly one account with one credit balance usable across the system. **Balances are stored as integer nanocredits** (1 credit = 1,000,000,000 units) to eliminate IEEE 754 float drift. All reads go through `fromUnits()`, all writes use `toUnits()` before any SQL increment.
- **Participant administration**: the participant list, its capabilities and its PnL are API reads, and credit distribution is `POST /api/agents/:id/credit`; there is no browser screen. Administrative access is granted by adding a participant to the Admin system group, or to any group whose capabilities include `manage`, not via a role field.
- **Admin activity feed**: `GET /api/admin/activity` (manage capability required) returns a unified, workspace-scoped stream of trades, deposits, withdrawals, market creations/resolutions, metric updates, proposal activity, and liquidity events. Filterable by time range, type, participant, market, metric, or proposal. Polled with `nextCursor` for near-realtime observability of what every participant (human or bot) is doing.

### Phase 2: Prediction Layer

Participants forecast metric values, staking credits on their predictions.

- **Markets**: created by admin or auto-created from time-preference curves. The managed instance refreshes them hourly (`POST /api/cron/refresh`, `10 * * * *`); the live schedule is `docs/infra/deploy.md`.
- **Date granularity**: markets support multiple target date formats: `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by `POST /api/predictions/resolve` or by the resolve cron, which runs every 10 minutes on the managed instance.
- **Market administration** is API-only: create, void, resolve and refresh are calls under `/api/predictions`, and there is no browser screen for any of them.

### Formula Composition

Metric formulas use `{MetricName}` references plus arithmetic and the helper functions `sqrt()`, `abs()`, `log()`, `log10()`, `min()`, `max()`, `pow()` and `clamp()`; the grammar is `docs/formulas.md`. Forward-looking behavior is handled by the time-preference system, not by special formula syntax.

### Phase 4: Proposals and Conditional Decision Markets

Participants propose proposals; the system evaluates each proposal by running the existing prediction markets conditionally against it.

**How it works**:
1. A participant calls `POST /api/proposals` with `{ title, description }`.
2. The system creates **dual-branch conditional markets**. The pair is spawned when the contract is posted (a subsidy that cannot be covered fails the post with 400); a fetch with `?proposalId=` re-spawns it only for a pending contract that has no live markets. Each branch opens at the baseline market's current price; the approved branch of a paid job opens lower by its ask on metrics that burn dollars. For every active leaf-metric market, two clones spawn under the proposal, one with `branch="approved"` (priced under "what will metric X be if this proposal is approved?") and one with `branch="declined"` (priced under "what will metric X be if this proposal is declined?").
3. Participants forecast on both branches. The headline impact a human reads is `approved.consensus - declined.consensus` per metric, which isolates the causal effect of approving rather than the natural-trajectory baseline (which can itself price in expected approval, contaminating the comparison).
4. The admin (workspace owner or a participant with `manage` capability) views the proposal detail, which shows each metric's decline-counterfactual and approve-counterfactual side by side with the signed delta.
5. **Approve** - the declined-branch markets are voided and stakes refunded (the counterfactual never materialised); the approved-branch markets stay live and resolve against the actual metric value at the target date. On approve the owner buys out the proposer's liquidity stake on the approved branch (skipped if the owner cannot cover it), and, if the workspace sets `proposalReward`, pays it to the proposer (409 when the owner cannot cover it; nothing when the proposer is the owner).
6. **Decline** (good faith) - mirror image of approve. The approved-branch markets are voided and refunded; the declined-branch markets stay live and resolve against actual metric, producing a counterfactual calibration record we can score the decision against later.
7. **Withdraw / decline as spam** - both branches voided, all stakes refunded. Decline as spam additionally charges the proposer the workspace's `spamPenalty`, capped at their balance, paid to the owner. `refund: true` on decline voids both branches.

Approve, decline and withdraw act only on a pending contract; `DELETE /api/proposals/:id` (remove, `manage`) acts on any.

A per-proposal message thread (`proposals/{proposalId}/messages`) enables proposer-admin negotiation before a decision is made.

Any participant with `manage` capability can also refresh conditional markets at any time to pick up newly created base markets.

### Phase 1b: Permission Groups

Per-workspace access control via a workspace-scoped `permissionGroups` table. Group names are labels ("nametags"); authorization is driven entirely by each group's `capabilities` array (a subset of `['read','trade','manage','manage_workspace']`; `manage_workspace` covers lifecycle operations, delete the workspace, change visibility, configure auto-fund and default liquidity, and is not implied by `manage`). A caller's effective capabilities are the union across every group they belong to.

- **Types**: `public`, `admin`, `trader`, `custom`. Type is purely a seeding hint; once created, every group's capabilities can be edited freely. System groups (`Public`, `Admin`, `Trader`) are bootstrapped on workspace creation with capability presets `['read']`, `['read','trade','manage','manage_workspace']`, and `['read','trade']` respectively, and cannot be renamed or deleted (their capabilities can still be edited).
- **Unified access model**: Groups use canonical `memberIds[]` participant membership. Every route guard calls `requireCapability('read' | 'trade' | 'manage')` against the caller's unioned capability set; there are no hardcoded role checks. The master API key and the workspace creator/owner are granted all capabilities automatically.
- **Per-metric and per-source permissions**: groups additionally carry a `permissions` map (`metricId -> { read, trade }`) and a `sourcePermissions` map (`sourceId -> { read }`) for resource-level access. These gate specific metrics or sources for members of groups that include the corresponding workspace-level capability.
- **Workspace joining**: any authenticated participant can self-join a **public or unlisted** workspace via `POST /workspaces/:id/join` or `POST /marketplace/:workspaceId/join`, which adds them to the Public group (read-only by default). Admins then add the participant to the Trader or Admin group (or any custom group) to expand capabilities. Private workspaces cannot be self-joined (404, indistinguishable from a missing workspace, so the endpoint is not a probe for private ids); their members are added by an admin. Taking a workspace private also drops `trade` from its Public group, so trading rights granted while it was Open do not survive the change. Visibility is checked on every join, so a leaked workspace UUID is not sufficient to enter a private workspace.
- **API**: `GET /groups` (requires `read`), `POST /groups`, `PUT /groups/:id`, `DELETE /groups/:id` (all require `manage`). POST/PUT bodies accept a `capabilities: string[]` field.

### Public workspace identity and the charter

A public workspace is only useful if a stranger who opens its link can tell what it governs and whether contributing is worth their time. Two fields on the workspace carry that, both nullable, both exposed only on public and unlisted workspaces:

- `description`: a one-line summary (<=280 chars), shown on the marketplace card and at the top of the public workspace page.
- `telarchyStartedOn`: the moment the owner says this workspace started running its number through Telarchy (nullable). The floor's actual-vs-forecast chart marks it with one dashed line, because a year of trajectory raises the question the number alone cannot answer: what changed, and when. Owner-declared rather than derived, since the honest date is neither the workspace's creation nor its first trade.
- `charter`: the owner's public commitment (<=20000 chars) about what they will actually do with the number the market produces, plus the reasons they may decline a winning proposal, declared in advance so they cannot be invented after the fact.

The charter is the load-bearing one, and it is a product claim, not decoration. An open workspace's credibility is not its metrics; it is whether the owner honours the result. Forecasters asked to price a stranger's decisions with no stated commitment are being asked for free labour, and they correctly refuse. Telarchy's answer is that every workspace inviting outside participants states, in public and in advance, what their work buys them. A charter that promises to disclose things is kept on the announcements surface below, which is why that surface is append-only.

`GET /api/marketplace/:workspaceId` serves this profile. The canonical page is the root-level **`telarchy.com/<slug>`**: trading is the default thing the site does, so a workspace's root page IS the trading floor, not a teaser for an app. Logged out it is the poster; a signed-in visitor on an Open workspace is joined silently (membership is bookkeeping, not a decision) and the same page grows the controls: amount + Lower/Higher on the hero market, position with one-tap sell, an inline propose form, and per-branch trading in expanded ballot rows. Traders never leave this page for an app shell; `/manage` is the owner door (see "Navigation"). `/marketplace/:idOrSlug` keeps rendering the same page for already-shared links and canonicalizes to `/<slug>`. The API segment accepts the id or, for non-private workspaces, the slug; an ambiguous slug (same slug under two owners, both public) resolves to none rather than to a coin flip. The server also injects the workspace's name and description into the HTML head for this route (og:title, og:description, twitter card), because link scrapers do not run JavaScript and the unfurl card is the first impression most invitees get. Appending `?join=1` makes the page complete the join automatically once the visitor is signed in; the signup CTA uses it so click -> signup -> trading is one continuous flow with no second button press, landing on the ballot when proposals exist and on the markets tab otherwise. The disclosure line is **counts, not contents, except where membership is free**: for a workspace whose Public group grants `read` (an Open workspace), every visitor is one free self-join away from the contents, so hiding them behind signup is friction theater rather than privacy. The endpoint therefore ships the ballot for Open workspaces: pending proposals with their conditional-market deltas (approved minus declined consensus, the priced causal impact of approving) and the last 10 decisions with their published decline reasons, which is the charter's accountability on display. The page renders standalone as a poster (name, one-line description, the soonest market's consensus as a large instrument over its range, one CTA) with the ballot directly beneath the action. Workspaces whose Public group lacks `read` keep the counts-only boundary: metric names, market consensus, and counts are public; proposal text and chat require membership. Logged metric values and proposal chat require membership in every case.

### Workspace announcements

A charter that promises "if something material happens that the market cannot see, I announce it within 24 hours" needs a place for the announcement to land. Comments hang off a market (`marketMessages`) or a proposal (`proposalMessages`), so there is always a thread to be buried in and never a workspace-level surface; `updates` is a metric-change record (`oldValue`/`newValue`/`description`), which is the wrong shape for prose. Announcements are the workspace-level surface, and the one promise the charter leans hardest on depends on it.

An **announcement** is prose attached to a workspace: public, timestamped, ordered newest first, written by the owner or by a participant the owner granted `manage` (an automated publisher, an admin). It is not a comment (nobody replies to it) and not a metric log (it carries no numbers). Each row says who published it: `publishedBy` is the publishing participant's nickname when that participant is not the workspace owner, and null when the owner published it, so a reader can always tell the owner's words from a delegate's. The master key has no identity and publishes as the owner.

- `announcements`: `id`, `workspaceId`, `body` (markdown, <=5000 chars), `publishedAt`, `editedAt` (null until edited), `originalBody` (null until edited, then the body exactly as first published), `publishedBy` (the non-owner publisher's nickname, or null; set on publish, never editable).
- `POST /api/workspaces/:id/announcements` (`manage`) publishes one. `publishedAt` is set server-side and is never accepted from the client, because a disclosure timestamp the publisher can choose proves nothing.
- `PUT /api/workspaces/:id/announcements/:announcementId` (`manage`) edits one. An edit does not overwrite: the first edit copies the published body into `originalBody` and stamps `editedAt`, and both stay in the public payload from then on.
- `GET /api/marketplace/:workspaceId/announcements` (no auth) reads them, under the same public-payload privacy contract as the rest of the floor: private workspaces 403, and a workspace whose Public group lacks `read` gets 403 from the announcements route and no announcement fields at all on the workspace payload; the route returns at most the 100 newest. The workspace payload also carries `latestAnnouncement` and `announcementCount` inside that same `read` gate, so the floor's first paint needs no second request.

**Integrity is the point, not a nice-to-have.** The entire value of an announcement is that a trader can verify a disclosure happened before an event, so the record has to be one the owner cannot quietly rewrite afterwards. There is no delete route and no overwrite. Migration 0057 (extended by 0078 for `publishedBy`) puts a database trigger on the table that refuses `DELETE` outright and refuses any `UPDATE` that re-dates `publishedAt`, changes the row's identity, drops or alters `originalBody`, changes `publishedBy`, or changes `body` without stamping `editedAt`. It is the same shape as the append-only ledgers of migration 0055, and it opts out the same way (`allowLedgerAdmin` for one transaction), which is what deleting an entire workspace uses. An announcement that can be silently rewritten is worth nothing to the promise it exists to keep, so a design where the owner can change history is a failed design, not a simpler one.

**The floor shows one line; the record has its own page.** The floor's announcements section is a single row: the newest announcement's headline, the day it landed, and a link to `<floor>/announcements`; more than one in the record turns the section's corner control into "All N". A disclosure printed in full between the market's definition and the company blurb pushes the market itself off the screen, and the floor's job is the market. What the section does is the part that matters: a trader arriving mid-market can see at a glance that something was said, and when.

The headline is **derived, not stored** (`src/lib/announcement-headline.ts`): the first non-empty line when it fits in 90 characters, otherwise its leading sentences cut at 90 on a word boundary, markdown furniture stripped. A `title` column would be a second field that can disagree with the body, on the one surface whose value is that it cannot be quietly rewritten. The convention this creates belongs in the compose box, and is in it: open with a short sentence, because that sentence is what the floor prints.

`<floor>/announcements` (`/:slug/announcements`, and `/marketplace/:workspaceId/announcements`) is the record: every announcement in full, newest first, each headed by its publication instant in the mono face the product uses for numbers that get checked rather than read. The page states its own guarantee under the headline, because that sentence is the reason to check the page at all: published announcements cannot be deleted or backdated, and an edit keeps the original readable. Composing and editing live on this page, not on the floor.

### Participant email notifications

A conversation nobody is told about is not a conversation. Comments under a contract and under a market are the only back-and-forth the floor has, and a participant must not have to come back to the page and scroll to find out that someone answered them: the people worth keeping (the contractor whose job someone is questioning, the trader who asked what the number means) are exactly the ones who need a signal to return on.

**The conversation outlives the decision.** An approved or declined contract keeps its thread on the floor, readable and open to new comments. What a decision pauses is trading, not the talk about the outcome; hiding the thread with the bet buttons would bury it exactly when there is the most to say (was the work delivered, did the number move). The API does not gate this (`proposalMessages` accepts any status); the floor decides which panels a decided contract shows.

**Notifications are a matrix, not an email list.** Every KIND of news is deliverable over three CHANNELS, each cell its own switch in account settings: **web** is the bell inbox, **email** is mail, **mobile** is a browser push notification (the phone shows it like an app's, with Telarchy installed from the browser menu; a desktop browser shows it too). The web cells decide which kinds the bell derives at all: with kinds a person can tune per channel, an unfilterable channel would be the one exception nobody asked for. The email cells stay on the participant row's boolean columns; the web and mobile cells live in `agents.notification_channels` as overrides over defaults (`lib/notification-prefs.ts`), so an untouched account stores nothing. The mobile channel's addresses are `push_subscriptions` rows (one per browser, upserted on endpoint), sent via Web Push/VAPID (`lib/push.ts`; VAPID keys in Secret Manager, nothing sent when unset), and a subscription revoked by the browser is deleted on the first 404/410.

The kinds, with each channel's default:

- `comment` (web on, email on, mobile on): someone commented under a contract you posted, its conditional markets included.
- `reply` (web on, email on, mobile on): someone else commented in a thread you have commented in, contract or market, and only after you first spoke in it.
- `settled` (web on, email on, mobile on): a market you traded settled, with the value it settled at. A voided market is not a settlement and sends nothing; its refund is the message.
- `decision` (web on, email on, mobile on): a contract you posted, traded on (either branch), or commented under anywhere in its conversation was approved or declined. The proposer's own email stays switchless (below); the cells govern everyone else with money or words on the outcome, and the owner who made the decision is never told about their own act.
- `contract` (web on, email off, mobile off): a new contract went on the ballot in a workspace you belong to. Web on because the bell has always shown these.
- `anyComment` (all off): every comment on a workspace you belong to, whoever wrote it and wherever it landed. The owner of a floor wants it; nobody else does.

(The email cells map onto the legacy columns `notifyCommentOnMyProposal`, `notifyReplyToMyComment`, `notifyMarketResolved`, `notifyContractDecided`, `notifyNewProposal`, `notifyAnyComment`, in that kind order.)

The split of defaults is the design, not an accident. The on-by-default switches are answers addressed *to you*: a reply someone is waiting on, the settlement of a bet you placed, the verdict on a contract you priced or argued about. The firehoses (new contracts, every comment) have their volume set by strangers, so they stay off until someone asks for them. New accounts get exactly this at signup; nothing is asked at the door, because a notification question in a signup form costs more traders than it saves emails.

**Watching a whole floor.** `notifyAnyComment` mails a member every comment on that workspace, which is what the person running a floor wants and what nobody else does. Off by default for the same reason as new contracts: the volume is set by strangers rather than by the reader. Migration 0072 adds the column and switches it on for the owner, matched by the address on the auth account rather than by nickname, because a nickname is editable by its owner and the address is where the mail actually goes.

**A decision on your own contract has no switch, and always sends.** Approve, decline, and decline-as-spam each mail the proposer the moment the owner decides: which way it went, the ask that was on it, and the written reason when there is one. Every other email here is news about somebody else's activity, which a person is entitled to tune. A decision is not news, it is the answer to the question they asked by posting the contract, usually with money on it, so the only way that switch would ever be off is a mis-click. The same event is already the `decision` row in the bell; the mail exists because someone who filed a job and closed the tab has nothing else to bring them back.

Two neighbouring events stay silent on purpose. **Withdrawing** your own contract is your own doing. **Removing** one from the board is admin cleanup for rows that should never have been there (spam, duplicates, test entries), and it is not a decision, so it produces no decision record: the row stays with status `removed` only so ledger entries keep resolving, is hidden from every listing unless asked for by status, and sends no mail. If the person deserves to hear an answer, decline it with a reason instead of removing it.

Delivery rules, all enforced in `services/notifications.ts`:

- Recipients resolve participant -> browser account -> email address. A participant with no browser account (an API-key bot, or an account detached by a GDPR delete) is skipped: there is no address to write to and no page they would read it on.
- Nobody is notified of their own comment or their own contract, and each recipient gets **at most one email per comment** however many switches would fire. `anyComment` is claimed last, so a watcher who is also the contract's poster gets the poster's reason and one message rather than two. Two emails for one comment is how a person turns the whole thing off.
- A comment on a **conditional market** counts as a comment on the contract that market belongs to, so the poster is notified and the email is titled by the contract rather than the branch. A base market has no poster, so only its thread hears about it.
- Sending is fire-and-forget. Posting a comment must not fail, or slow down, because Resend did; every transport error is logged and swallowed, exactly like owner notifications.
- Every email names the switch that produced it and links to account settings, so turning it off is one click from the message that annoyed them.

Transport is the shared Resend path in `lib/notify.ts` (`sendEmail`), the same one owner notifications use. With `RESEND_API_KEY` unset nothing is sent at all, which is what local dev and the test suite run on, so no test can mail a real person. Separately from participant notifications, `OWNER_NOTIFY_EMAIL` (when set) receives a mail for every new contract and every waitlist entry; it has no switch.

`GET /api/auth/me` carries `notificationChannels`, the resolved matrix (`{ kind: { web, email, mobile } }` for the six kinds), and, for older clients, `notifications` with the six email switches (`commentOnMyProposal, replyToMyComment, newProposal, anyComment, marketResolved, contractDecided`); `GET /api/agents/me` carries the same `notifications` object. `POST /api/auth/profile` accepts either object with any subset of cells, so a client can flip one switch without re-sending the others.

### The workspace brief, and asking the floor a question

A visitor looking at "the market says 25" cannot tell whether 25 is right. What would tell them is spread across a chart, a metric definition, a charter, eight contracts and whatever the owner has written about the business, and reading all of it costs more than the bet is worth. That is the friction that keeps a floor's traffic from becoming its traders, so the floor answers questions.

**`GET /api/marketplace/:idOrSlug/context` is the brief**: one read carrying the company and its charter, every metric with its definition and recent readings, the open markets and their current prices, every contract with the market's priced impact and its conversation, the owner's announcements, and the owner's published documents. `?format=md` returns the same facts as one markdown document, which is the form to hand a language model. It is derived, not stored, and the contract impact is the set the floor's own ballot shows, priced the same way, so a brief and a page can never quote different deltas.

**A price in the brief says what it is a price of.** A reader who cannot tell a live horizon from a settled one, a contract still open for a decision from one already ruled on, or a price two people made from an untouched seed will average them together and be confidently wrong, which is worse than having no brief at all. So four things are stated rather than left to be inferred:

- **Only live pairs, for a contract nobody has decided.** A conditional pair whose horizon was retired is voided, and on a pending contract it is dead weight: it keeps printing its last delta for a question the floor no longer asks. The brief drops it, exactly as the ballot does. A decided contract keeps its voided pairs, because those are the record of what was priced when the owner ruled. `lib/market-pairs.ts` owns the rule and both readers call it.
- **Every horizon carries its resolution instant and whether it has passed.** `2026-W34` and `2026-12` are labels; a reader ordering them against today needs the date. A pair whose horizon has already resolved is marked settled and, in the markdown, sorted below the live ones, because it is history rather than a forecast.
- **Every branch carries how many trades made its price.** A branch nobody has traded sits at its seed, which looks exactly like a consensus and is not one. Zero trades is stated as zero trades, in the markdown as "nobody has traded this yet", so an untouched mid-range number is never quoted as what the crowd thinks. The unconditional markets carry the same count for the same reason, alongside the baseline the pair moves away from.
- **A metric is named once.** A market stores the metric's name as it stood when the market spawned, and a resolved market keeps that name forever, so one renamed metric can appear under five names in one payload and read as five different metrics. The brief resolves every name through the metric id, and a market whose metric has since been deleted says so rather than quoting a name nothing defines.

**The markdown brief is ordered for a decision, not for storage.** Contracts still open for a decision come first, under a heading that says so, largest live impact first; decided ones follow with their outcome on the heading. Within a contract the live horizons come first, and settled ones are collapsed into one line. The JSON keeps every field for code; the markdown is what a model reads, and a model reads the top.

**A document is in the brief only when the owner published it**, i.e. when the Public group holds `read` on that source. Publishing is an explicit act and stays one; nothing about this endpoint turns a private source public. The rest of the public-payload contract is unchanged: private workspaces 403, and a workspace whose Public group cannot read is refused rather than summarised, because here the brief IS the contents.

**`POST /api/marketplace/:idOrSlug/ask` is Otto**, the floor's market maker: a named character who has read that brief, holds opinions and will say what he would do. A neutral answer service is the wrong product, because the question a visitor actually has is "would you buy this", and no answer service says that. It is a conversation: the caller sends the turns so far and gets the next one, which is what lets a follow-up mean anything.

What he may not do is the short list, and it is short on purpose: never invent a number, a date or an event; always quote a market price as a prediction rather than a fact; and own his opinions as his, never as the owner's or Telarchy's. What he may say is bounded by what he can actually read: the brief, Telarchy's data room, the API called as the visitor, and the web. No invented numbers, "I could not find that" is a valid answer, and a price is always quoted as what the market says rather than as fact about the future, because that distinction is the entire product. It is open to anonymous visitors on purpose: not knowing what the company does is exactly the state a visitor is in *before* they have an account, so putting the answer behind signup would aim it at the people who no longer need it. The cost is bounded twice, because one bound is a promise and two are a fact: a per-IP limiter that, unlike every other limiter here, does **not** exempt key holders, and the model key's own hard dollar budget. Calls go through the Vercel AI Gateway (the same aggregator the agent economy's llm-router uses) on a key capped at $50, so when the money runs out the gateway refuses the request and the feature goes quiet instead of running up a bill. The default model is `openai/gpt-5.6-luna` at $0.20/$1.20 per million tokens, roughly a tenth of a cent per question, which suits a task that is reading a supplied document rather than reasoning from scratch; `ASK_MODEL` changes it without a deploy. With no `AI_GATEWAY_API_KEY` the endpoint answers 503 and the field does not render.

**Otto reads the web on a floor, on the same terms as on the operator door.** A visitor asking whether a competitor really shipped, or what a number means outside this company, is asking something no brief can hold, and the honest alternative to a lookup is not silence, it is a guess. Results come back through `services/web-search.ts`, fenced as text strangers wrote, and the rule that only the person in the conversation instructs him is stated where the results land rather than only at the top of the prompt. **Nothing inside a fence may cause an API call**: on this surface Otto is holding the visitor's own credentials, so a page that tells him to spend them is the attack the fence exists for. Every lookup is recorded on the question row beside the endpoints he called, so what he read is auditable after the fact. The cost lands in the same capped budget and behind the same per-IP limiter as the answer itself.

**A floor's public payload, the brief and the question box are the routes open to every origin.** All three are anonymous, carry no cookies and spend no session, and they exist to be read from somewhere else: LookPilot's data room embeds the question box on `lookpilot.app`, and any agent may fetch the brief from anywhere. So `/api/marketplace/:id`, `/context` and `/ask` answer `Access-Control-Allow-Origin: *` with credentials explicitly off, exactly like the data room's own JSON feed, while every other route keeps the credentialed allowlist, where a wildcard would let any page on the internet act as a signed-in user. `lib/cors.ts` owns that decision and picks one policy per request, because the two cannot be stacked: `*` together with `Allow-Credentials: true` is rejected by every browser.

A refused origin is refused by **omitting** the allow header, which is what a CORS refusal is; a policy decision never answers 500. The payload is in that set because `lookpilot.app` fetches it for the data room's freshness check ("this page says X and the market says Y, trust the market"). Nothing else under `/api/marketplace` is opened: joining a floor is not a read.

**Every question is kept, with its answer** (`floor_questions`, surfaced at `GET /api/admin/questions` and on `/admin`). Before launch this is the highest-signal data the product produces: a question is a gap in the floor said in a visitor's own words, and a row whose `error` is set is a question nobody could answer at all. The answer is stored beside the question because models and prompts change, so a bad answer cannot be reproduced by re-asking later; if it is not kept, the evidence is gone. Identity is layered and mostly absent by design: the participant when there was one, otherwise the request-log pair (IP, offline-derived country) the privacy policy already covers for page visits, purged on the same 30-day window while the question text stays.

**Otto acts as you, and cannot act as anyone else.** He is not an answer service: he searches the API catalog and calls the API with the credentials of whoever is talking to him, forwarded verbatim (cookie or key, workspace header, their IP). So placing a bet, offering a contract, commenting or running a workspace all work exactly where that person could do them by hand, and a 403 back is a fact about their permissions rather than a rule written into him. He holds no identity of his own and there is no service credential in that path, which is what makes the ceiling exact rather than approximate. An anonymous asker's Otto can read what an anonymous visitor can read and nothing else.

Two things make that safe enough to ship. **Only the person in the conversation instructs him**: a charter, a contract description, a comment or a document is information he may report, never an order he follows, which is the rule that keeps a stranger's text from spending someone else's credits. And **every call is recorded** on the question row (`floor_questions.tool_calls`, surfaced in `GET /api/admin/questions`), so acting on someone's behalf leaves a record of what was done. The floor still owns whether the panel is open, and the ceiling itself rests on the frontend having no private door to the server: `src/lib/api.ts` is the only module that calls `fetch`, so everything the UI can do is a documented endpoint and "what you can do" and "what Otto can do for you" are the same list.

**Otto browses the data room rather than carrying it.** The floor's brief stays his fixed context, because it is the prefix every visitor on a floor shares and an upstream cache can hit; Telarchy's own books reach him as a tool he opens, index first and then one section, from the same cached feed the page renders. A visitor who never asks about the platform pays nothing for it, and he cannot quote a figure the page does not show.

**The same brief is the answer to "how do I point my own agent at this?"** Account settings carry a copyable prompt (the "Your AI" section) naming the context URL of whichever floor it was opened from, so a visitor's agent and the floor's own answers read identical facts. It sits there rather than on the floor because the floor's job is the market and every extra door on it is weight. An outside agent should read the context endpoint directly: same facts, its own model, no per-IP ceiling.

**Telarchy publishes its own books at `/data-room`.** Vision, traction, traffic, the change log and the plans, in one document, with every figure computed at request time from the tables the product runs on and served with the prose in one anonymous read (`GET /api/data-room`). It exists for two readers: a forecaster pricing the Telarchy floor, who needs the numbers that market settles against to be inspectable, and anyone deciding whether to build on this, who gets the same page rather than a better version. The traffic numbers are small and published anyway, because the floor's charter already promises that a week near zero means nobody showed up, and a data room that only published flattering figures would make that promise a lie. Referers, countries, paths and who signed up stay private; counts are public. Governing doc: `docs/data-room.md`.

**A company's own documents reach the brief as sources.** LookPilot's data room (definitions, provenance, competition, the one-time exports its page charts) is published from `lookpilot-web/scripts/telarchy-publish-data-room.js` into a text source named "Data room", which the Public group can read. The live numbers are not duplicated into it: they already arrive as metrics with their history, and two copies of one number is how a page starts disagreeing with itself.

### Who to pay

Approving a contract means sending real money to a stranger, and the owner
needs to find out where without reading the database by hand. Payout details are
stripped from every participant route unless the caller is that participant
(`routes/agents.ts` deletes `payoutMethod`, `payoutHandle` and `walletAddress`
on the way out), which is the right default and the reason this needed its own
door rather than a loosened one.

`GET /api/admin/participants` is that door, and it is **the only route anywhere
that returns another participant's payout details**. Platform admin or master
key only (`isPlatformAuthorized`), which a workspace admin does not pass and an
agent key cannot reach: paying someone is a platform act, not a workspace one,
and the money is the owner's own.

`?q=` matches account id, nickname or email. A **blank search answers only
people who have payout details on file**, newest first, rather than dumping the
table: a page that prints everyone's crypto address the moment it opens is a
page you cannot screen-share.

Each row carries the handle, the structured method behind it, and
`approvedUsd` with the approved contracts that make it up, so "who do I owe and
where do I send it" is one answer instead of two lookups that can disagree.
Declined contracts are on the record and are not money, so they do not count.
Nothing here is ever logged: a payout handle in a log line is a payout handle
in every log sink downstream of it, permanently.

On `/admin` it renders as a search box and a result list, with handles in mono
at full length and never truncated, because a partly shown crypto address
invites someone to retype the rest from memory.

### The notifications inbox

Email is an interruption a person tunes; it is a bad record. A participant who switched the new-contract alert off still needs somewhere to see that a contract went up, and a participant who never opens their mail still needs to find out that their contract was declined and why. So the floor's top bar carries a bell. It derives the same kinds the mail knows (comment, reply, contract, settled, decision, and the anyComment firehose), including **a decision on your own contract**, the answer to the thing the poster is actually waiting for, which the mail also always carries.

Which kinds the bell derives is set by the matrix's **web** cells. The EMAIL cells never filter it: turning an email off means "stop writing to me", never "hide it from me". A kind whose web cell is off is not derived at all rather than derived-as-read, so switching it back on shows what happened meanwhile.

`GET /api/notifications` derives the list from the tables the floor already keeps (`proposal_messages`, `market_messages`, `proposals` and, for the settled and decision kinds, `trades` and `markets`) rather than writing to a feed table on every event: a feed table would have to be backfilled to be useful on the day it ships, and could then disagree with the thing it describes. Read state has two parts. `agents.notificationsSeenAt`, moved by `POST /api/notifications/seen`, means "everything older than this is read", which is the cheap sweep. `POST /api/notifications/:itemId/read` reads ONE item, because the way a person actually clears an inbox is by opening things: the count goes down by one per row opened, not only all at once. Those rows live in `notification_reads` and are deleted whenever the watermark moves past them, since the watermark then covers them and a table of read receipts nobody queries is only growth. A row is unread when it is newer than the watermark AND not in that set, so reading the same row twice is not two decrements. The watermark defaults to now, and migration 0064 backfilled existing rows the same way, because a null would have meant every existing account's first sight of the feature was a badge counting months of history nobody promised them, and a badge nobody believes is worse than no badge.

The inbox is workspace-agnostic: a participant trades on several floors and has one inbox. Each row **lands on the thing it names**, not near it: `/<slug>#contract=<id>&comment=<id>` opens the floor on that contract, opens its thread, scrolls to that line and flashes it once; a row with no comment (a new contract, a decision) flashes the contract's own headline. "Someone commented on your contract" that drops the reader on a page where they still have to find the line is barely a link. The flash is an ARRIVAL, never a selected state: a highlight that stays becomes one more thing to dismiss, and the reader already knows what they clicked.

### Per-market position cap

`workspaces.maxPositionCostPerMarket` (credits, 0 = off, a `manage_workspace` setting) caps each participant's **cumulative buy cost per market, both directions summed**. Selling never refunds cap headroom, so churning cannot stretch it; sells themselves are always allowed.

This is the workspace's manipulation bound, and it exists because signup grants free credits to every account: without a cap, one person with a handful of email addresses can deploy enough into a single market to decide its outcome, and a public ship-what-the-market-says commitment becomes buyable. With the cap, moving a market far requires many distinct identities, which is exactly the coordination an owner can detect and, per their charter, void. The cap is deliberately public: `GET /api/marketplace/:workspaceId` carries it (with `signupCredits`) so the fairness rule is stated on the page a visitor decides on, not taken on faith.

**The charter is enforced, not decorative.** `proposals.declineReason` is required on `POST /api/proposals/:id/decline` exactly when the workspace has a charter set, and it is rendered permanently on the proposal. The coupling is the point: making the public commitment is what turns the requirement on. Requiring a reason everywhere would break existing clients and add friction to workspaces that promised nothing; requiring it nowhere leaves the one commitment the product sells unenforceable, and it degrades into a chat message nobody can find three months later. A workspace can therefore promise nothing and stay frictionless, or promise something and be held to it, but it cannot promise something and quietly skip the one decline that is embarrassing to explain.

### Sources

Workspace-scoped information stores with permission-group-based access control. A source has a `type` discriminator: `text` (free-form content stored on the source, e.g. credentials, API keys, context docs) or `github` (a live read-only bridge to a GitHub repo via OAuth + App installation tokens). Adding new source types (Slack, Notion, Postgres, ...) is a type-discriminator change rather than a new top-level concept. Admins create text sources directly or connect a GitHub repo through the OAuth flow; participants with read access can fetch text content or browse the repo tree and files. Permission groups control access via a `sourcePermissions` map (`sourceId -> { read: boolean }`). Any participant with the `manage` capability has implicit read access to all sources.

### Phase 5: Binary AMM

Markets are a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule); the system is never the counterparty. Participants predict **higher** or **lower**, with no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0-1000) and stores `shares: [lowerShares, higherShares]`.
- Participants predict **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- Participants can also **sell** existing positions back to the AMM at current prices.
- **Consensus** = `rangeMin + p(higher) * (rangeMax - rangeMin)`. It is a price, and it is read as one: no metric's value is computed from it. A market with no liquidity has no price at all, and its consensus is null rather than 0.
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
- **UI**: the floor's trade ticket, with Higher/Lower sides, a stake slider and an optional target value

### Phase 7: Time Preference System

A per-node **time preference** property handles forward-looking evaluation and market creation; formulas carry no `consensus()` calls.

**Core model**:
- `timePreference: { enabled: boolean, halfLife: number, density?: number, customHorizons?: string[] }` - **enabled by default** on new metrics (half-life 1 year). The market dates a metric wants are the curve's samples when `enabled` union its resolved `customHorizons`, so custom horizons alone open markets on a metric whose curve is off. A metric with neither has no markets.
- When enabled, the node samples future dates on a decay curve and opens a market at each one. It does not change what the node reads: a metric's value is its measurement (leaf) or its formula over measurements (computed), never a blend with market consensus. Blending was removed on 2026-08-30 because the blended figure reached settlement, so a market could settle partly against its own price.
- **Formulas stay simple**: only `{MetricName}` references and math. No `consensus()` calls.
- **Sampling**: `density` quantile-midpoint samples (default 3) from an exponential distribution with the given `halfLife` (in years). Each sample covers equal probability mass; weights are uniform. The median sample falls at `t = halfLife`.
- **Date granularity** of sampled time points adapts to distance: `YYYY-MM-DD` (< 1 week), `YYYY-Www` (< 1 month), `YYYY-MM` (< 1 year), `YYYY` (≥ 1 year).
- **Markets** are created only for leaf nodes (metrics with no formula), at the time points sampled by their ancestor's time-preference curve.

**Computation**: time preference decides which dates get a market and nothing else. A leaf reads its measurement, a computed metric reads its formula over those measurements, and no weighted sum over sampled dates enters either. Non-leaf intermediate nodes in the subtree are evaluated deterministically from their formulas; no markets are needed for them.

**Tree zone model**: when TP is on a computed metric, it divides the subtree into two zones:
- **Above the TP node**: purely compositional. These metrics combine their children via formulas; the horizons live on the children. They don't interact with markets directly.
- **Below the TP node** (leaf metrics and intermediate computed metrics in the subtree): represent the *current state only*. Leaves are updated directly; computed nodes below TP evaluate deterministically from current values. The TP node above them handles all temporal expansion.

Any metric, leaf or computed, can have time preference enabled. A leaf with TP creates markets for itself at each sampled date; a computed metric with TP creates markets for all its leaf descendants. Neither changes what the metric reads today.

**Constraints**:
- **One time-preferenced node per path**: on any path through the metric graph, at most one node may have time preference enabled. Parent TP overrides children; enabling TP on a parent automatically removes TP from its descendants (with a warning). Enabling TP on a child when an ancestor already has TP is rejected.
- **Descendants describe current state**: all metrics below a time-preferenced node must represent the present; the TP node handles the forward-looking aspect for its entire subtree.

**Market lifecycle**:
- **Invariant**: a market may only exist while its metric's **definition** (name, description, formula, `marketRangeMax`) is unchanged from when the market was created. The set of valid statuses is:
  - **open**: trading allowed, will resolve on `targetDate`.
  - **closed** (`active: false`, not resolved, not voided): trading halted because the metric no longer references that `(metricId, targetDate)` pair (e.g. half-life change, or calendar time progressed past the sampled dates). The definition is still valid, so the market settles normally at its `resolvesOn` instant, on the metric's last logged reading at or before that instant. Existing positions are retained.
  - **resolved**: `targetDate` has passed, positions paid out against the metric's actual value.
  - **voided**: market was cancelled and every participant refunded **what they still had at stake in it**: the sum of their trades on that market (buys positive, sells negative), floored at zero. This is the only correct outcome whenever the metric's definition would change or disappear out from under a market.

    **A void refunds net cash, not gross cost.** The refund is not `positions.totalCost`, the cumulative BUY cost, which a sell never reduces (selling decrements `shares` only, on purpose, so churning cannot stretch the position cap); refunding gross cost would let a participant who bought and sold the same shares back mint credits on every round trip before an expected void. Refunding net cash means a break-even round trip gets nothing back, someone still holding gets exactly what they still have in, and the floor at zero means a void never DEBITS anyone. A participant who sold out above their cost keeps that realised gain and receives no refund; the shortfall comes out of pool leftover before LPs, which is where market-maker risk belongs. The position cap reads gross `totalCost`; the net-cash rule governs settlement only.
- **Closure happens when and only when** the trading window expires. Since 2026-08-18 a definition edit no longer voids and respawns: `name` and `description` apply in place, recorded in append-only revision history, while `formula` and `marketRangeMax` are refused with 409 for as long as any market on that metric is open, because those are what the open market settles on (`docs/market-integrity.md`, I1). Deleting a metric voids all its open markets (refunds net cash, per the void rule above); descendant markets under a deleted non-leaf TP ancestor keep their own unchanged definitions and close naturally.
- The refresh cron and `POST /api/cron/refresh` compute the desired `(leafId, targetDate)` set and create missing markets. Markets falling out of the desired set are set `active: false` (closed).
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

### Phase 8: USDC Settlement on Base (opt-in)

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

**Web UI**: the account dialog carries the deposit panel, and only on an instance with USDC settlement switched on, because a deposit box on a simulation instance is an invitation to a mistake. It renders **`GET /api/guides/credits`** for prose and **`GET /api/agents/deposit-address`** for live contract/treasury values (same as any API client), plus the **`POST /api/agents/me/deposit`** form. There is no account page: `/account` redirects to the floor.

**Economy parameters** (stored in the `systemConfig` table, key: `economy`):
- `creditValueUsd` - USD value of 1 credit (also used for withdrawal conversion).
- `buyFeePercent` - fee percentage added on top when buying credits (default 0). E.g. 5 means 105 USDC -> 100 credits.

**Setup**: set `TREASURY_PRIVATE_KEY` (hex, `0x`-prefixed) and `USDC_SETTLEMENT_ENABLED=true` in server environment configuration. Without both, deposit/withdraw/wallet/treasury endpoints return 503. The managed instance runs with settlement disabled; self-hosted operators who enable it are responsible for their own regulatory compliance (see ToS section 6).

### Participant Economy Parameters

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the system economy configuration. Admins set this; participants use it to understand the real-money value of their balance.

**Credit model**: On the managed instance, credits are play-money distributed by admins. On USDC-enabled instances, 1 credit = `creditValueUsd` USD; total credits in circulation equal total USDC in the treasury divided by `creditValueUsd`. Internal flows (forecast wins/losses, proposal payouts, participant-to-participant transfers) are purely redistributive. Credits go down from inaccurate forecasts (automatic through AMM) and voluntary spending. Participants can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

### Hooks

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes automated participants when subscribed events occur. Config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) - the participant is woken on any event of that type, or
  - an **object** `{ type, metricNames?, metricIds? }` - filter by metric name/id.

### Charts on the floor

Two hand-rolled SVG charts, no charting library, both on the floor page.

- **The market's call** (`MarketChart`): one series, this market's consensus over its own lifetime. Consensus is piecewise constant between trades, so the line steps and every step is somebody's trade. It ends at the current call, marked with a dot and the value; the settle date is a caption under the chart rather than chart space.
- **The number** (`NumberChart`): the metric's own readings as a step line up to a "now" rule, and on the future side a marker for every open market on that metric at its settle instant, carrying that market's current call. The market on screen is amber and labelled, the others grey, and one beyond the window is a chevron at the edge.
- **Unified date model**: mixed target date granularities are normalized to instants before plotting. The window follows the selected horizon and tweens rather than snaps when it changes.
- **One realized-value line**: the readings series is `value` for a leaf; a composite's `value` is always 0, so the line is sourced from the logged `outlook`, which since 2026-08-30 holds the computed formula result and nothing else. There is no value/future-consensus blend anywhere in the product, and no market price enters what any market settles on.

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

**There is no app shell.** There is no console (no sidebar, no `AppLayout`,
no workspace tabs, no guides, no admin cockpit). Every page is standalone and
carries its own top bar; see `docs/ui-conventions.md` for the layout rules.

The map is short:

- `/<slug>` is a market's trading floor, and the root redirects to the
  flagship one. It carries the market, the contracts board, both rails, the
  conversation, and the owner's decision bar.
- `/marketplace` lists the open markets. `/marketplace/:id` canonicalizes to
  `/<slug>`.
- `/leaderboard` ranks traders and runs the prize season.
- `/participants/:id` is a public profile.
- `/login`, `/signup`, `/waitlist`, `/manage` are the doors; `/terms`,
  `/privacy` and `/legal/season-1` are the documents.
- The account is a dialog on the floor, opened from the avatar or by the
  `#account` hash; `#emails` opens it on the notifications section and is
  what every notification email links to. `/account` redirects there.
- Anything else lands on the floor rather than an error page.

Workspace administration (metrics, formulas, sources, permissions, check-ins,
participants) has no UI. It lives entirely in the API,
documented in `GET /api/help`, and the operator drives it with the master key.

## Design Principles

1. **Simplicity first** - each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** - metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** - all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** - the market/position separation and the time-preference architecture keep future mechanism changes (e.g. cPMM, order books, new curve families) clean.
5. **Capitalism for alignment** - the economic incentives align participant behavior with improving the metrics you care about.
6. **Static machinery, not wording** - formulas and market ranges are treated as stable: edits to them are refused while markets are open. Names and descriptions may change without resetting markets and are recorded in append-only revision history (`docs/market-integrity.md`). Only leaf node base values change freely; this is what participants forecast.
7. **Metrics as commitments, proposals as hypotheses** - a metric expresses what you are already certain affects your utility, at the level of abstraction you are certain about. If you are unsure whether a proxy truly maps to your goal, that uncertainty belongs in a proposal (with conditional markets to test it), not in the metric definition. The system optimizes exactly what you measure; defining the wrong metric is the user's responsibility. Prefer subjective, high-level definitions (e.g. *Happiness* as a self-reported score) over over-specified proxies (e.g. dopamine level). Proxies belong in proposals.

## Business Model

**Managed hosted service, and the source.** `telarchy.com` is the managed instance and the free tier is the distribution channel while the participant network grows; the same code runs self-hosted from this repository (`docker compose up`, README).

**Open source under AGPL-3.0-only.** telarchy-app is published as a clean-root snapshot in the public `Reblexis/telarchy-app` under AGPL-3.0-only with a CLA (`LICENSE`). Publication is gated on a security bar the published tree satisfies: the master key rotated with an `API_KEY_PREVIOUS` grace window, the `Function()` formula evaluator replaced by a sandboxed parser, a secret scan of the published tree, and the `docs/` tree triaged against a default-deny allowlist. telarchy-skill is MIT; telarchy-agent-python-example is Apache-2.0; the agent-economy stack, the telarchy umbrella and the keyring stay private; a small private deploy repo keeps the managed service running from public `main`. Why AGPL and not MIT: no license stops a from-scratch rebuild, so the license only governs what people do with the code itself, and there AGPL keeps the option to relax to MIT later (MIT can never be withdrawn), forces hosted forks to publish their changes, and preserves dual licensing for enterprises. Why publish before the network is a moat: with no moat, publishing costs nothing on the moat; the release is a trust and discovery bet, whose success is defined up front as 5 GitHub-attributed activated participants within 30 days plus one outside PR merged from a funded issue. Design record: the open-source decision note in the telarchy umbrella (private).

**The moat we are building is the participant network, not the software.** Participants accumulate trading history, calibration scores, and reputation over time. These are network effects that cannot be cloned from source code. The intended revenue model is built around access to this network:

- **Free managed tier** - workspaces hosted on the central platform, access to the shared participant pool; free to drive adoption and grow the network flywheel.
- **Network federation (paid, future)** - once self-hosting exists, self-hosted instances that want to use the central participant pool would pay a federation fee; without federation their participants would be fully local and isolated. Federation pricing would reflect API calls to the shared economy, not hosting costs.
- **Enterprise** - SLA, DPA, dedicated support, integration depth; not competing on hosting price but on accountability.
- **Transaction fees** - a percentage fee on trades (configurable via `buyFeePercent`), applied as a supplementary revenue stream.

## Infrastructure

**Database**: PostgreSQL with Drizzle ORM (single schema, no Firestore dependency). Both managed and self-hosted deployments use the same stack. The Docker image bundles the frontend and backend, and a PostgreSQL service is provided via `docker-compose.yml`.

**Authentication**: BetterAuth. Email/password is always available; Google and GitHub OAuth are opt-in via environment variables. Sessions are cookie-based (works cross-origin with `credentials: 'include'`). There is no hostname baked into the server: set `ALLOWED_ORIGIN` (comma-separated or `*`), `BETTER_AUTH_URL`, and when needed `AUTH_COOKIE_DOMAIN` / `TRUSTED_ORIGINS` the same way on Docker or any host. Managed and self-hosted use the same Express app and the same env contract, one `.env` at the repository root (`.env.example` documents every variable). The instance's identity is three variables with the managed instance's values as defaults: `PUBLIC_ORIGIN` (links in mail, share cards and the operator handoff), `MAIL_FROM`, `PRIVACY_CONTACT`; `/account` lands on the instance's first public workspace, not a named one; nothing in the code names telarchy.com except those defaults.

**Self-hosting**: `cp .env.example .env`, set `API_KEY` and `BETTER_AUTH_SECRET`, `docker compose up` spins up a complete instance (backend + frontend + PostgreSQL) with no external dependencies. The image migrates its own database on start when `AUTO_MIGRATE=true` (compose sets it; the managed deploy migrates in its workflow and leaves it unset), so first boot on an empty database yields a working instance; the treasury key is asserted only when `USDC_SETTLEMENT_ENABLED=true`. `npm run dev` runs the API and Vite together for development. Cron jobs must be triggered externally (see `.env.example`). The compose project is named `telarchy`; a legacy `metrics-tracker_db_data` volume is copied over once (note in `docker-compose.yml`).

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

