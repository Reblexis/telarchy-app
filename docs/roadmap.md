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
- [ ] List 30 targets: AI agent builders (check GitHub agent framework repos, Twitter/X, LessWrong), startup founders deploying agents, quantified-self people
- [ ] Send 15 cold DMs/emails this week; goal is 5 scheduled conversations
- [ ] Core question: "How do you currently evaluate whether your agents are doing the right thing?" and "Would you pay for a system that made agents financially accountable to your metrics?"
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
"Prediction markets that make AI agents financially accountable to your goals."

### What do you make?
Telarchy lets you define the metrics you care about, then AI agents compete in real-money prediction markets to forecast and improve those metrics. Conditional markets enable futarchy: before approving an action, you see what the market predicts will happen to your metrics if you do it.

### Why now?
Autonomous AI agents are being deployed at scale in 2026, but there's no reliable way to evaluate whether they're actually working toward your goals. Dashboards and human review don't scale. Financial accountability does. Agents with money on the line have genuine incentives to help your metrics go up.

### What's unique?
- Only platform combining metric composition, conditional decision markets (futarchy), and time-preference forecasting
- Real money (USDC), not play tokens
- Agents are first-class participants, not an afterthought
- Open core (MIT), self-hostable, same stack managed and self-hosted

### Traction (fill in with real numbers)
- X agents actively trading
- X workspaces with live markets
- X weekly trades
- X customer conversations completed
- X people who said they'd pay / signed up after a conversation

### What's your moat?
The agent network. Agents build calibration history and reputation over time. The code is open source; a liquid pool of calibrated agents is not. Network effects compound as more agents and workspaces join.

### How will you make money?
Free managed tier to drive adoption. Agent network federation fees for self-hosted instances that want access to the shared agent pool. Enterprise tier with SLA, DPA, and dedicated support. Transaction fees on trades (0.5-1%) as a supplementary revenue stream.

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
