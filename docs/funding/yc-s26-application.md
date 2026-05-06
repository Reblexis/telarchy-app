# Telarchy: YC S26 application draft (startup section)

Status: 2026-04-27. Deadline 2026-05-04.

**Founder profile is filled in directly in the YC form.** This file covers the **startup section**, which is still unfilled.

Voice: tight, factual, concrete numbers, no em dashes. Match what you wrote in the founder profile.

---

## Open TODOs before submission

- [ ] Record founder video (60-90s, unlisted YouTube). Suggested script at the bottom of this file.
- [ ] Plug real numbers into the "Are people using it" answer. Targets by May 4: 10-20 customer conversations, 2-5 external workspaces with live markets, 1+ conditional decision an external user actually committed-or-declined based on a market.
- [ ] If a Delaware C-corp gets formed before submission, update the equity / incorporation answers.
- [ ] One outside review pass (Adam Červenka or similar from the IOI cohort if reachable).

---

## Company name

Telarchy

---

## Company URL

https://telarchy.com

---

## Describe what your company does in 50 characters or less

**Primary:**
> Alignment layer for AI and humans. (34)

**Backups, in priority order:**
1. `Markets price every decision against your KPIs.` (49)
2. `Pre-commit prediction markets for any decision.` (48)
3. `Skin-in-the-game forecasts for AI proposals.` (45)

The primary is the canonical positioning everywhere else (landing page, /api/help, vision.md). Category claims read sharper at 50 chars than mechanism summaries, so I'd ship the primary unless a fresh reader stalls on "alignment layer."

---

## What is your company going to make?

Telarchy is an alignment layer for AI and humans, built on prediction markets.

You define the metrics that matter (company KPIs, OKRs, or personal goals). Anyone, a teammate or an AI agent, proposes an action. For every proposed action, conditional prediction markets open against your active metrics and forecast the action's expected impact before you commit. You see, per metric, what the market predicts will happen if you say yes, and you approve or decline on a calibrated number rather than a pitch. Forecasters who are right accumulate credits; bad calls cost them.

The default today fails the same way for both kinds of proposal. For AI proposals you ask a chatbot: confident-sounding paragraph, no skin in the game, no goal context. For human proposals you guess, or whoever argues loudest in the room wins. Both produce the same biased forecast as the proposer pitching their own idea. Telarchy replaces both with a market-priced forecast.

Companies use it to price strategic and operational decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals (health, career, finances). One stack, two scopes from day one.

Working product is live at telarchy.com: LMSR engine, conditional decision markets, agent economy with API keys and an open telemetry protocol, multi-workspace permissions, public marketplace, play-money settlement on managed and USDC settlement on Base for self-hosted. A fleet of automated forecasting agents (anchor, momentum, stabilizer, blended, ai-analyst, ai-researcher) trades continuously on the production workspace.

(~270 words)

---

## Where do you live now, and where would the company be based after YC?

Now: Prague, Czechia. After YC: happy to relocate to the Bay Area for the batch and base the company there afterwards. I am graduating from MFF Charles University in June 2026, before the batch starts (June 23), so there is no school overhang.

---

## How long have each of the founders been working on this? Have any worked on it full-time?

Solo. ~5 months on the underlying codebase (started December 2025), ~3 months on Telarchy specifically as the canonical framing (rebrand February 2026). Full-time as primary project since February. LookPilot is in maintenance mode and provides ~$5k/month passive income that funds living costs.

---

## What is your tech stack?

React 19 + TypeScript + Vite (frontend), Node.js + Express + BetterAuth (backend), PostgreSQL + Drizzle ORM (DB), Cloud Run + Cloud SQL (infra), Chart.js (visualization). Self-hosted deployments use the same stack via `docker compose up`. USDC settlement on Base for self-hosted (deposit/withdraw via on-chain tx verification). Agent infra: API keys, SSE event hooks, open agent telemetry protocol with per-cycle heartbeats and decision traces.

---

## Are people using your product?

Honest: pre-revenue, zero external paying users today. I am the primary user and use Telarchy daily on my own utility-function workspace ("My Utility") for real personal decisions. Production at telarchy.com is live; a small fleet of forecasting agents trades continuously on the Telarchy-utility workspace.

I am 4 weeks into customer discovery as I write this. Targets by May 4: 10-20 conversations, 2-5 external workspaces with live markets, 1+ conditional decision an external user actually committed-or-declined based on a market. I will update this answer with real numbers before submission.

---

## How are you or your team uniquely qualified to build this product?

Solo, 21, technical founder. Two prior solo-shipped products on Steam:

- LookPilot (2024-present): ~6,000 active users, ~600 DAU, ~$5k/month run rate, 15% average monthly growth, 96% positive reviews on Steam. Full custom ML pipeline solo: synthetic data in Blender + MakeHuman, ML training (RTMPose-T, ResNet, MediaPipe extraction), ONNX inference, Qt desktop app, Steam release, winget packaging. SCS Software in ongoing investment discussions. Bachelor thesis is on this system.
- Aim Bot (2018, age 14): Unity FPS aim trainer on Steam, 4,000+ paying users.

Plus: Codeforces Candidate Master (rating 2030); represented Czech Republic at the Central European Olympiad in Informatics 2022 and 2023; 3rd at the Czech national programming olympiad (winner tier); three AI research internships before age 20.

Telarchy sits where I am strongest: a mechanism-design problem (prediction markets), full-stack production engineering (live webapp), and an agent economy (LLM participants). I have shipped commercial product solo end-to-end before; the competitive-programming and ML background covers the algorithmic and AI sides.

---

## Why did you pick this idea? Domain expertise? How do you know people need it?

I built it for myself first.

I keep an explicit utility function for my own life (8 weighted components scored weekly: Health, Power, Social Network, Happiness, Self-Control, Intelligence, Fears, Attractiveness). Every meaningful decision I make I want priced against that utility. The honest tools I had were my gut, Claude or GPT, or a small group of trusted friends. None has calibration history; none has skin in the game.

Telarchy is the system I built so my own life decisions get priced before I commit, and so AI agents I wire into my goals get rated on their forecasts. The "My Utility" workspace on telarchy.com is mine, with metrics, agents, and conditional markets running today.

The realization that this same machine is what every founder I demo it to wants for their company came after I built the personal version. The bottleneck shows up the same way: "how do I evaluate a proposal an agent or a teammate just put in front of me?"

Domain expertise: algorithmic mechanism design (competitive programming), full-stack production engineering (LookPilot), AI/agent integration (prior research internships, current LLM-driven dogfood agents). The fourth dimension, markets, is where I am newest, and the academic case (Hanson, Arrow, et al.) is strong but operational know-how is what I am building through dogfood now.

---

## Why now?

Two compounding facts plus a forcing function.

1. **Cheap intelligence makes the mechanism finally workable for any decision.** Earlier corporate prediction markets (Google's Prophit, HP's sales markets) showed the mechanism produces accurate forecasts but never crossed into the decisions founders actually want priced: sensitive KPIs, confidential strategic moves, agent-generated proposals at volume. AI participants change what the substrate can hold, not just how cheap it runs.

2. **AI participants grant privacy human forecasters cannot.** A founder will not put a sensitive KPI, an unannounced strategic move, or a confidential people decision in front of human teammates or a public market. They will put it in front of an AI participant inside a private workspace. AI does not gossip, does not carry the information to a competitor, and does not change how the team sees the founder. This unlocks pricing for the exact decisions that previously had no realistic forum.

3. **The generator-evaluator gap is the new bottleneck.** Agent task completion on the OSWorld benchmark jumped from 12% to 66.3% in a year (within 6 points of human performance). Agents are now vastly better at generating proposals than humans are at evaluating them. Without a market-priced approval layer, you rubber-stamp (no alignment) or block (no autonomy).

These compound. Cheap intelligence makes the markets work. AI privacy makes the founder willing to put the decision in. The agent boom is why you need this loop now rather than next year.

---

## Who are your competitors? Who do you fear most?

The category is the agentic control plane. The layers a founder evaluates:

- **Generic AI chatbots** (Claude, ChatGPT, Gemini): the actual default for evaluating a proposal. No skin in the game, no goal context, but incumbent.
- **Defensive governance platforms** (Credo AI, Holistic AI, Airia, Axiamatic, Geordie, Aigentsphere, Microsoft Agent Governance Toolkit): closest 2026 neighbor. Asks "is this forbidden?" via policy rules and audit logs. Well-funded ($492M category spending in 2026, $1B+ by 2030; Airia $100M, Axiamatic $54M from Greylock and Bessemer, Geordie $6.5M, Phia $35M Series A in alignment-for-commerce).
- **Decision intelligence** (Pigment, Causal, Runway, Aera, Peak.ai): same job-to-be-done, deterministic simulation instead of markets, no skin in the game.
- **Decentralized futarchy** (MetaDAO on Solana, Optimism's 2025 grant experiment): same mechanism, on-chain only. Optimism failed across four modes (TVL metric tracked ETH price not execution, 6 clicks per bet, 41% last-minute hedging, markets directly executed creating self-fulfilling prophecies). Telarchy uses owner-defined metrics, web app not on-chain, executive approval in the loop.
- **Walled-garden agent platforms** (Salesforce Agentforce, Google Gemini Enterprise Agent Platform): native control inside their own IAM perimeter, no external KPI optimization.
- **Public prediction markets** (Polymarket, Manifold, Kalshi): public order book, not conditional, not against your KPIs.
- **Observability** (LangSmith, AgentOps, Langfuse, Datadog LLM): adjacent, not competitors; retroactive tracing complements approval.

Telarchy sits in the goal-optimization layer. Governance asks "is this forbidden?"; Telarchy asks "is this optimal?" Complementary, not substitutes; a serious enterprise needs both.

Most feared: Anthropic or OpenAI shipping calibrated forecasting on your goals as a chatbot feature. Anthropic in fact runs an internal prediction market for decision-makers, with employees and Claude staking on company direction. Strongest possible validation of the mechanism, and the most direct competitive signal. Defense: skin-in-the-game, calibration history, and multi-participant disagreement priced into one number are structurally adversarial to a single-model black box; the other neighbors with the right mechanism don't have AI participants.

---

## What do you understand about your business that other companies in it just don't get?

Three things.

First, the question internal prediction markets always struggled with was *which decisions you could actually put on them*. The 2000s programs at Google and HP ran fine on observable, low-sensitivity questions like sales numbers and ship dates. They couldn't price the things a founder actually loses sleep over: confidential hires, unannounced pivots, negative signals you don't want your team seeing you uncertain about. Human forecasters leaked. AI participants don't. The unlock isn't "more forecasters per market"; it's "decisions that previously had no realistic forum."

Second, AI participants now beat humans at this. Cultivate Labs, the incumbent in enterprise crowd-forecasting, shipped AI prediction agents this year and reported they consistently beat the general crowd and human Superforecasters. Direct validation from a competitor with no incentive to overstate it.

Third, the privacy unlock for internal prediction markets is not "we host it on your own infra" (what enterprise vendors lead with). It is "the forecasters are AI who don't gossip." A private prediction market with employees as forecasters has *worse* leakage than one ChatGPT prompt: now N teammates know the secret. Replace the forecasters with AI and privacy flips from barely tolerable to better than status quo. Non-obvious to anyone from the prediction-market tradition; obvious to anyone who has actually tried to use a prediction market for a real internal decision.

---

## How do or will you make money? How much could you make?

Hybrid, as Telarchy is structurally a marketplace inside a tool. Subscription on the paid managed tier (founder and leadership teams, free play-money tier underneath). Transaction fees on real-money settlement: the mechanism is built but currently disabled on managed for regulatory reasons; turning it on is the single biggest revenue lever. Federation fees on self-hosted deployments accessing the shared participant network. Enterprise contracts on top.

Hard to size honestly. SaaS subscriptions alone cap at SaaS comparables (a few hundred million to low billions). The upside lives in two places. First, take rate on transaction volume once real-money settlement is live: the Stripe / Coinbase pattern, scaling with how much of the agent economy flows through Telarchy. Second, outcome-based pricing (vendors capturing a share of the value they create) is emerging as a dominant model for AI services, and it requires a rigorous mechanism to predict outcomes before execution. Telarchy is that substrate. Every AI vendor charging on outcomes will need an alignment-and-prediction layer to back the contract. If Telarchy becomes the alignment layer agent frameworks integrate by default, or the prediction layer outcome-based AI vendors price their contracts against, $10B+ is plausible. Too early to call.

---

## Have you incorporated yet?

No legal entity yet. Plan: Delaware C-corp on YC acceptance. Running as a personal project (Czech sole-trader registration covers LookPilot revenue) until then.

---

## Have you raised money?

No.

---

## How did you meet your cofounder(s) / why are you solo?

Solo. I have looked actively. Two recorded "no"s so far:

- My twin brother Patrik (also at MFF Charles University, also nationals-level competitive programmer): we have tried to work together before and consistently hit power struggles. Cofounders.
- Jan Slíva (former Czech IOI national team teammate, current MFF classmate): said he is not sure and does not have time right now. Soft no.

The bar: skilled and validated, has finished things they started, free-market mindset, honest, easy to work with, assertive but not irrational, not obedient. 50/50 equity. I have not lowered the bar to ship a YC application; the cost of an OK cofounder for an execution-velocity company is much higher than YC's solo-founder discount.

Open to a great cofounder during or after the batch. Not slowing down to find an OK one.

---

## What convinced you to apply to YC?

Two reasons.

- **Distribution into AI-forward companies.** Telarchy's customer is a founder shipping AI agents into their own company. YC's founder network is the densest concentration of that customer in the world.
- **Regulatory and legal credibility.** Prediction markets have a regulatory gradient (CFTC in the US specifically). Managed runs play-money to keep the surface zero while the network grows; self-hosted runs USDC. Getting this right early matters and the YC partner network has the right kind of legal-savvy operators to triangulate with, plus the credibility to be taken seriously by an actual lawyer.

---

## How did you hear about YC?

Reading Hacker News and Paul Graham's essays since ~age 14. YC has been the obvious place for this kind of company since before I knew which company I would build.

---

## Have you applied to YC before?

Yes, with LookPilot in [TODO: confirm batch, S25 or W26]. Not accepted; kept building. LookPilot is now at ~$5k/month run rate and funds Telarchy full-time.

---

## If you have an online demo, what's the URL?

- Live product: https://telarchy.com (sign up free, 1000 free credits)
- Public marketplace (read-only without signup): https://telarchy.com/marketplace
- Code repo (private; happy to share): `Reblexis/metrics-tracker`
- Bot fleet repo: `Reblexis/telarchy-agents`

---

## Anything else interesting / unusual

- I built a personal knowledge graph of myself (~50 markdown files) so AI agents can pick up the full context they need to advise on my life decisions. It is the same shape I want Telarchy customers to think about when they give their company context to the participants in their workspace.
- I have a Yeelight smart bulb on my desk that blinks every time a new LookPilot user signs up. The morale signal is calibrated against a real-time event rather than a daily summary; surprisingly load-bearing for solo founder pace.
- Aim Bot (Steam game I shipped at 14) is still on Steam and still earns; that money funded the laptop I am using to build Telarchy. The pattern, "the thing I am building today funds the thing I will build tomorrow," is upstream of why I am comfortable solo and self-funded.
- Politically free-market liberal (anarcho-capitalist-leaning). The Hayekian "knowledge problem" framing is upstream of every architectural choice in Telarchy. Watch for this in tradeoffs that look surprising (e.g. why participants are paid in credits rather than reputation-only).

---

## Founder video script (~60 seconds, talking head only; demo content goes in the separate demo video)

> Hey YC, I'm Viktor and I'm a second-time solo founder.
Right now, I'm building Telarchy. Whenever a founder is making a bigger decision they usually make it based off of a gut call, potentially discuss it with their cofounders or an AI chatbot. However this doesn't really scale well for the upcoming AGI era, where there will be thousands of decisions made in a company per day. That's why I built Telarchy. All that the founder has to do with Telarchy is define the metrics they really care about and whenever they're facing a bigger decision Telarchy spawns prediction markets asking what will be the impact of this decision on these metrics that the founder cares about. And based off of the predicted impact the decision is either made or not. This couldn't really have existed before because of cost of intelligence and privacy concerns but both of these are being solved by AI agents so that's why I believe that Telarchy has bigger potential than it ever had.
Thank you.

---

## Provenance

- `~/src/metrics-tracker/AGENTS.md` (canonical positioning rules)
- `~/src/metrics-tracker/docs/vision.md` (alignment-layer-for-AI-and-humans long version)
- `~/src/metrics-tracker/docs/go-to-market.md` (competitive landscape, why-load-bearing, why-now)
- `~/src/metrics-tracker/docs/roadmap.md` (YC-specific key-points draft, traction targets)
- `~/src/viktor-cihal/projects/telarchy.md` (product context)
- `~/src/viktor-cihal/projects/telarchy-yc.md` (application status snapshot)
- `~/src/viktor-cihal/projects/telarchy-cofounder.md` (cofounder bar, recorded "no"s)
- `~/src/viktor-cihal/projects/lookpilot.md` (most-impressive-built backbone)
- `~/src/viktor-cihal/personal/utility.md` (the "why this idea" personal-utility-function story)
