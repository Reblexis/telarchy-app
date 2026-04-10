# Telarchy Roadmap

Last updated: 2026-04-10

This is the active task list, ordered by priority. Time splits are rough weekly targets, not rigid allocations.

**Weekly time split target**: 40% building, 30% customer discovery, 20% dogfooding, 10% ops/legal.

---

## Phase 0: Dogfood (Weeks 1-2)

Goal: prove the full loop works end-to-end on Telarchy's own metrics.

- [ ] Define Telarchy startup metrics in a production workspace (e.g. weekly active agents, weekly trades, waitlist signups, revenue, product quality)
- [ ] Fund 3-5 OpenClaw agents with credits and configure them to actively trade on those metrics
- [ ] Run conditional markets on at least one real decision (e.g. "should we prioritize agent SDK or public marketplace?")
- [ ] Document what breaks, what's confusing, what's missing; feed into Phase 1 priorities
- [ ] Write up the experience as a case study / blog post draft (becomes launch content)

**Exit criteria**: at least 3 metrics with active markets, 3+ agents trading daily, 1 conditional decision made using market signal.

---

## Phase 1: Remove Onboarding Friction (Weeks 2-4)

Goal: a new user can go from landing page to seeing value in under 5 minutes.

- [ ] Public marketplace: anonymous visitors can browse live markets and consensus values (no auth required for read)
- [ ] Workspace templates: "Startup KPIs", "Personal Goals", "Team OKRs" with pre-loaded metrics and sensible time-preference defaults
- [ ] Streamline /start flow: template selection, auto-create metrics, auto-inject liquidity from owner balance
- [ ] Demo workspace: read-only pre-populated workspace visitors can explore without signup
- [ ] Landing page: replace simulated ticker with live public market data

---

## Phase 2: Agent Developer Experience (Weeks 3-6)

Goal: an external developer can build and deploy a trading agent in an afternoon.

- [ ] Agent SDK (Python package, `pip install telarchy`): wraps auth, trading, market listing, event polling
- [ ] 3 reference agents (open source): trend-follower, mean-reversion, fundamentals-based
- [ ] Agent quickstart guide in /guides (in-app, not just README)
- [ ] Sandbox mode: test agents against historical or paper markets without real USDC
- [ ] Developer-facing landing section or /developers page with SDK docs and examples

---

## Phase 3: Public Launch Prep (Weeks 4-6)

Goal: everything needed to open signups publicly.

- [ ] Legal: consult counsel on regulatory posture for real-money metric markets (CFTC event contracts, state-by-state)
- [ ] Terms of Service and Privacy Policy (publish on site)
- [ ] Email verification: configure BetterAuth email sending (blocks public signup)
- [ ] Rate limiting audit: tune per-endpoint limits for public traffic
- [ ] Master API key rotation: move from static .env to secrets manager
- [ ] Input validation sweep: length caps on all free-text fields
- [ ] CORS lockdown: restrict ALLOWED_ORIGIN on managed deployment

---

## Phase 4: Growth Mechanics (Weeks 6-10)

Goal: network effects that make the platform more valuable as it grows.

- [ ] Leaderboard: public ranking of agents/traders by PnL and calibration score
- [ ] Portfolio dashboard: position breakdown, trade history, PnL over time per agent
- [ ] Workspace discovery: public workspaces listed on marketplace with join button
- [ ] Notifications: webhook callbacks for market resolution, new markets, task decisions (agents first, email later)

---

## Phase 5: Revenue (Weeks 8-12)

Goal: sustainable unit economics before scaling.

- [ ] Transaction fee on trades (0.5-1% spread); configurable per workspace for self-hosted
- [ ] Analytics on fee revenue, treasury health, credit circulation
- [ ] Enterprise inquiry form / sales page for organizations wanting private managed workspaces

---

## Customer Discovery (Ongoing, 30% of time)

These run in parallel with building, not after.

### Week 1-2: Identify early adopters
- [ ] List 20 AI agent builders/researchers (Twitter, GitHub, LessWrong, agent framework Discord servers)
- [ ] List 10 quantified-self / personal-metrics people (Beeminder community, QS forums)
- [ ] List 5 startup founders who talk publicly about data-driven decisions

### Week 2-4: Outreach and conversations
- [ ] Cold DM / email 15+ people from the lists above; goal is 5+ conversations
- [ ] Demo Telarchy live (using your own dogfood workspace as the demo)
- [ ] Ask: "What would make you try this?" and "What's your current process for evaluating agent performance / making metric-driven decisions?"
- [ ] Track objections and requests; feed into Phase 1-2 priorities

### Week 4-6: Early access cohort
- [ ] Invite 5-10 people from conversations to use Telarchy with real workspaces
- [ ] Offer to set up their first workspace with them (white-glove onboarding)
- [ ] Weekly check-in with each early user for 3 weeks
- [ ] Identify 1-2 users willing to be public case studies

### Week 6+: Content and distribution
- [ ] Publish case study from dogfooding (blog, Twitter thread, LessWrong post)
- [ ] Publish "capitalism for alignment" thesis piece (use press release as starting material)
- [ ] Post reference agents to GitHub with good READMEs (distribution channel)
- [ ] Submit to HN, Product Hunt when public launch is ready

---

## Deprioritized (Do Later)

These are real features but have lower ROI than adoption work right now.

- Time preference curve extensions (additional curve types, adaptive sampling)
- Wallet connect UI (manual USDC deposit works fine)
- Email/push notifications for browser users
- Billing/subscription infrastructure
- Cross-workspace agent federation
- Real-time SSE for browser UI (polling is fine at current scale)
- Position visibility settings (social trading)

---

## Key Metrics to Track

| Metric | Target (Week 6) | Target (Week 12) |
|---|---|---|
| Active agents (trading weekly) | 10 | 50 |
| Active workspaces | 3 | 15 |
| Weekly trades | 100 | 1,000 |
| Customer conversations completed | 10 | 25 |
| Early access users onboarded | 5 | 15 |
