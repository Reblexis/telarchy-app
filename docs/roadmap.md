# Telarchy Roadmap

Last updated: 2026-04-10

**Deadline: YC S26 application due ~May 4, 2026 (24 days)**

Everything is oriented around submitting the strongest possible YC application. YC cares about: (1) a working product, (2) evidence people want it, (3) a clear big idea, (4) founder velocity. We already have (1) and (3). The 24 days are about getting (2) and demonstrating (4).

**Time split**: 40% customer conversations + outreach, 30% dogfooding + demo polish, 20% building what unblocks adoption, 10% application writing.

---

## Week 1 (Apr 10-16): Dogfood + Start Talking to People

### Dogfood (prove the loop)
- [x] Define Telarchy startup metrics in a production workspace (Telarchy Utility workspace, revised to follow guide principles)
- [x] Fund agents via telarchy-agents repo, configure them to trade on production every 5 min
- [ ] Run at least 1 conditional market on a real decision (e.g. "should we prioritize agent SDK or public marketplace?")
- [ ] Record a short screen capture of the full loop working (metrics, agents trading, consensus moving, conditional market revealing signal); this becomes the YC demo video backbone

### Customer discovery (start immediately)
- [ ] List 30 targets: startup founders and operators deploying AI agents, agent developers (check GitHub agent framework repos, Twitter/X, LessWrong), quantified-self people
- [ ] Send 15 cold DMs/emails this week; goal is 5 scheduled conversations
- [ ] Core question for founders: "How do you currently evaluate whether a proposal (from a human or an agent) is worth shipping?" and "Would you pay for a system that forecast its impact on your metrics before you committed?"
- [ ] Core question for agent developers: "What would it take to run your agents against real-world outcomes with skin in the game?"
- [ ] Track every conversation: who, what they said, objections, interest level

### Build (only what unblocks demos and signups)
- [x] Public marketplace read access (Telarchy workspace set to public visibility)
- [x] Make landing page show real live data instead of simulated ticker

---

## Week 2 (Apr 17-23): Conversations + First Users

### Customer discovery (this is the priority)
- [ ] Run 5+ conversations (video call or voice, not just text)
- [ ] Demo using your own dogfood workspace as the live demo
- [ ] Send 10 more outreach messages
- [ ] Ask interested people: "Want to try it? I'll set up your workspace with you right now."
- [ ] Goal: 2-3 people actively using Telarchy by end of week (even if you hand-hold them through setup)

### Dogfood
- [ ] Keep agents running; update metric values daily
- [ ] Note every friction point and bug you hit; fix the ones that would embarrass you in a demo

### Build (only if it unblocks a real user)
- [ ] Workspace templates if onboarding friction is losing people (otherwise skip)
- [ ] Fix any bugs surfaced by dogfooding or user sessions

---

## Week 3 (Apr 24-30): Traction Numbers + Application Draft

### Customer discovery (keep pushing)
- [ ] 5 more conversations (cumulative 10+)
- [ ] Goal: 5+ external people who have signed up or actively used the platform
- [ ] Ask early users for a one-line quote you can use in the application ("Telarchy helped me X")
- [ ] If anyone says "I'd pay for this," write it down verbatim

### YC application draft
- [ ] Write first draft of all application fields (see structure below)
- [ ] Record demo video: 60-90 seconds showing the full loop (define metrics, agents trade, consensus forms, conditional market evaluates a decision, USDC settlement)
- [ ] Have 1-2 people review the application draft and give feedback

### Build (only demo-critical)
- [ ] Polish anything that looks broken in the demo video flow
- [ ] If you have user requests that take < 2 hours and make the product clearly better, do them

---

## Week 4 (May 1-4): Polish and Submit

- [ ] Finalize application text
- [ ] Re-record demo video if needed (tighter, clearer)
- [ ] Update traction numbers with latest data
- [ ] Get one more review pass from someone who's done YC or applied
- [ ] Submit by May 3 (one day buffer)

---

## YC Application: Key Points to Hit

### One-line description
"Telarchy is an alignment layer for AI and humans. You define your metrics; participants, human or AI, propose actions; markets price each proposal against those metrics; you approve on a number, not a vibe."

### What do you make?
Telarchy is an alignment layer for AI and humans, built on prediction markets. Founders and leadership teams define their KPIs and OKRs. Participants (human or AI) propose actions with a price. Conditional markets forecast the expected per-metric impact of each proposal. The owner approves or declines with a calibrated number, not a gut call. Over time, as markets accumulate calibration data, high-confidence positive-delta proposals can clear automatically, shifting routine decisions off your plate. Companies are the headline use case; individuals use the same mechanism on personal goals.

The realistic alternatives a founder uses today both fail the same way: for AI proposals it is a generic chatbot (no skin in the game, no goal context, opaque); for human proposals it is a gut call or whoever argues loudest in the room. Telarchy is the system that beats both defaults for any decision the founder cares enough to define.

### Why now?
Two compounding facts make this the right moment.

1. **Intelligence is the cheapest it has ever been.** Prediction markets thrive in cheap intelligence: every proposal can be evaluated by many forecasters at near-zero per-forecast cost. The historical reason internal prediction markets failed, that you needed dozens of motivated human forecasters per market, is gone. A single LLM-driven participant can produce calibrated forecasts on hundreds of conditional markets per day for cents.
2. **AI participants grant privacy that human forecasters cannot.** A founder will not put a sensitive KPI, an unannounced strategic move, or a confidential people decision in front of human teammates or a public market. They will put it in front of an AI participant inside a private workspace. AI does not gossip, does not carry the information to a competitor, and does not change how the team sees the founder. This unlocks pricing for decisions that previously had no realistic forum.

On top of this, AI agents are also generating the demand: a single automated participant can propose 1000 actions a day, and no exec can review them by hand. Markets scale where unaided humans don't.

### What's unique?
- Only platform combining conditional decision markets, metric composition, and time-preference forecasting.
- Private, workspace-scoped markets for internal decisions (not public betting on news events).
- Participant symmetry: humans and AI propose, forecast, and get paid on the same terms.
- Serves both companies and individuals from day one on the same mechanism.
- Play-money on the managed instance (no regulatory surface while we grow the network); the same stack runs USDC-settled on self-hosted deployments.

### Traction (fill in with real numbers)
- X participants actively trading
- X workspaces with live markets
- X weekly trades
- X customer conversations completed
- X people who said they'd pay / signed up after a conversation

### What's your moat?
The participant network. Participants build calibration history and reputation over time. The plan is to eventually open-source the code; a liquid pool of calibrated participants is not clonable from source. Network effects compound as more participants and workspaces join.

### How will you make money?
Free managed tier to drive adoption. Network federation fees for self-hosted instances that want access to the shared participant pool. Enterprise tier with SLA, DPA, and dedicated support. Transaction fees on trades (0.5-1%) as a supplementary revenue stream.

### What do you need YC for?
Distribution to AI-forward companies deploying agents. Credibility for enterprise conversations. Guidance on regulatory posture for real-money prediction markets.

---

## What NOT to Build Before Application

Everything below has lower ROI than one more customer conversation.

- Agent SDK / Python package (do after acceptance, not before)
- Sandbox mode
- Wallet connect UI
- Email verification (manual approval is fine for early users)
- Billing infrastructure
- Leaderboard
- Notifications
- Time preference extensions
- Any feature nobody has asked for yet

---

## Numbers to Have Ready by May 4

| Metric | Minimum | Stretch |
|---|---|---|
| Customer conversations | 10 | 20 |
| External users who signed up | 3 | 10 |
| Agents actively trading | 5 | 15 |
| Workspaces with live markets | 2 | 5 |
| Quotes from users | 2 | 5 |
| Conditional decisions made via market | 1 | 3 |
