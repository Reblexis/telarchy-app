# Telarchy: Go-to-Market Plan

## What's Already Built

- Full LMSR prediction market engine with binary trading (buy/sell, AMM shares, balance deduction)
- Agent economy with registration, API keys, credit system, approval flow, task payouts
- Multi-workspace support with role-based access (owner, admin, trader, viewer, permission groups)
- USDC settlement on Base (deposit/withdraw via on-chain tx verification)
- Time-preference system for forward-looking evaluation (decay-weighted temporal aggregation)
- Conditional markets for futarchy (task proposals, market summaries per task)
- Event feed + SSE hooks for agent automation
- Admin UI for metrics, markets, agents, tasks, workspace management
- Graph/chart system for metric visualization and history
- Self-hosting: single `docker compose up` deploys the full stack (frontend + backend + PostgreSQL)
- BetterAuth (email/password, optional Google/GitHub OAuth via env vars)
- PostgreSQL + Drizzle ORM (no Firebase dependency; same stack for managed and self-hosted)

## The Two Customer Segments

### Segment A: Market Creators

Orgs/individuals who define goals and want prediction insights.

**Value prop:** "Define your goals as metrics, let the market tell you the future, use futarchy to make decisions."

**What's missing:**

1. **Self-service signup** — New users land in a "pending" state and must create or be invited to a workspace. The `/start` flow exists but needs polishing — templates for common use cases (startup KPIs, personal health, team OKRs) would reduce friction.
2. **Per-market access control** — All markets require auth. Need a `visibility` field (public, unlisted, private) and public-facing read endpoints for market discovery.
3. **Billing** — No payment integration. Options: subscription, transaction fees, credit spread, or free tier + premium.
4. **Creator dashboard** — Current admin UI works but lacks analytics, "getting started" state for empty workspaces, and market performance summaries.

### Segment B: Traders / Agent Builders

People who bet on markets or build automated agents.

**Value prop:** "Find markets, bet on outcomes, earn real money. Build agents that trade for you."

**What's missing:**

1. **Public market discovery** — No way to browse markets without auth. Need a public marketplace page.
2. **Trader-facing UI** — Traders interact via the Agent Portal page and API. The admin web UI is for workspace owners. Needs clearer separation.
3. **Self-service deposit UI** — Backend USDC APIs exist but no frontend. Need wallet-connect integration.
4. **Agent developer experience** — Only one OpenClaw skill. Need: developer portal, API docs, SDK, example agents, sandbox.
5. **Leaderboard / reputation** — No public ranking. Data exists but isn't surfaced.
6. **Portfolio dashboard** — `/api/agents/:id/dashboard` is minimal. Need position breakdown, trade history, PnL over time.

### Cross-Cutting Gaps

1. **Landing page** — A landing page exists but needs live public market widgets for social proof.
2. **Rate limiting** — `express-rate-limit` is enabled globally; ensure limits are tuned for production load before going public.
3. **Legal** — ToS, privacy policy, regulatory considerations for real-money prediction markets.
4. **Notifications** — No email or push. Traders want resolution alerts; creators want prediction alerts.

## Implementation Sequence

### Phase 1: Foundation (Done ✓)

- ~~User model rework~~ — BetterAuth with email/password + optional OAuth; workspace-scoped roles (owner/admin/trader/viewer); platform admin via `ADMIN_EMAILS` env or `platformAdmin` DB flag.
- ~~Workspace multi-tenancy~~ — All tables scoped by `workspaceId`; workspace switcher in sidebar.
- ~~Trade race condition fix~~ — Trade endpoint wrapped in PostgreSQL `FOR UPDATE` row lock inside a transaction.
- ~~Security hardening~~ — Rate limiting enabled, API keys hashed (SHA-256), CORS configurable via `ALLOWED_ORIGIN`.

### Phase 2: Creator MVP (Next)

- **Self-service onboarding** — Polish the `/start` flow; add templates for common use cases.
- **Per-market visibility** — `visibility` field on workspaces/markets; public read endpoints.
- **Creator dashboard** — Market analytics, workspace settings, member invite links.

### Phase 3: Trader MVP (parallel with Phase 2)

- **Public market browse** — Live public markets visible without auth; search/filter; market detail pages.
- **Wallet connect + deposit UI** — Frontend for USDC deposit/withdraw.

### Phase 4: Growth

- **Leaderboard** — Top traders/agents by PnL. Public.
- **Agent developer portal** — Docs, SDK, example agents, sandbox.
- **Notifications** — Email/webhook alerts for key events.
- **Billing** — Platform fees / subscriptions.

## Privacy, Security, and Data Sovereignty

### Approach: Open Core (GitLab Model)

The full backend and frontend are MIT-licensed. Anyone can self-host from the public Docker image. True E2E encryption is incompatible with prediction markets — the server must compute on the data (AMM, resolution, payouts). Same constraint GitLab faces with CI and code search.

Trust is built through security practices, compliance, and transparency:

- **Encryption at rest** — GCP/Firestore default (AES-256). CMEK for enterprise tier.
- **Encryption in transit** — TLS via Firebase Hosting + Cloud Functions.
- **Access controls** — Strict internal policies, admin audit trail.
- **DPAs** — Contractual commitments for enterprise customers.
- **Privacy policy and ToS** — Transparent about data storage, location, retention.
- **Data portability** — Self-service export (`GET /api/me/export`) and deletion (`DELETE /api/me`).
- **Self-hosted option (future)** — Docker image, Firestore replaced by Postgres/SQLite. Escape hatch for full sovereignty.

### Current Security Posture

**Strong:**
- Agent API keys stored as SHA-256 hashes, verified with `crypto.timingSafeEqual`
- No server secrets in frontend bundle
- Rate limiting via `express-rate-limit` (global + per-endpoint)
- PostgreSQL row-level locking on trades (no race conditions)

**Still needed before public launch:**
1. Master API key rotation — currently static in `.env`; move to secrets manager for managed deployment
2. Input validation gaps — `agentId` character limits, free-text length caps
3. Admin audit trail — log approvals, role changes, credit distributions
4. CORS lockdown — `ALLOWED_ORIGIN=*` fine for self-hosted; managed deployment should restrict to known domains

### Privacy / GDPR

1. Self-service data deletion (`DELETE /api/auth/me`)
2. Data export (`GET /api/auth/me/export`)
3. Privacy policy (PII inventory: emails, wallet addresses, free-text)
4. PII retention policy with auto-cleanup
5. Data residency documented in privacy policy

### Multi-Tenant Data Isolation

All tables include a `workspaceId` column; all queries filter by it. Mitigations:
- **Query abstraction** — workspace ID flows from `req.auth.workspaceId` on every request; no cross-workspace leakage possible via standard routes.
- **Integration tests** — Verify cross-tenant invisibility on every deploy.
- **Position visibility** — Owner and workspace admin only. Per-workspace setting for social trading.

## Infrastructure

### Current Architecture

- Frontend: React 19, Vite, Chart.js (served as static files by the Express backend in self-hosted mode)
- Backend: Node.js Express API (`functions/src/`)
- Database: PostgreSQL with Drizzle ORM
- Auth: BetterAuth (email/password + optional Google/GitHub OAuth)
- Managed deploy: Cloud Run (same image as self-hosted, different env vars)
- Self-hosted deploy: `docker compose up` (includes postgres service)

### Known Issues / Limitations

1. **No real-time updates** — Frontend polls every 60 seconds. SSE endpoint exists for agent hooks but not for browser UI updates.

2. **No email verification** — BetterAuth `emailVerified` flag is set but email sending is not configured. Needed before allowing public signup.

3. **Single PostgreSQL instance** — Trade throughput is bounded by PostgreSQL write capacity (~hundreds/second), which is fine for early scale. At very high load, consider read replicas or partitioning by workspace.

### Cost Estimates (managed PostgreSQL + Cloud Run)

- Small (100 users, 1K trades/day): ~$15-30/month
- Medium (1K users, 10K trades/day): ~$60-120/month
- Large (10K users, 100K trades/day): ~$250-600/month

## Competitive Landscape

| | Polymarket | Manifold | Metaculus | Telarchy |
|---|---|---|---|---|
| Money | Real (USDC) | Play (Mana) | None | Real (USDC) |
| Markets | World events | Anything | Forecasting Qs | Org metrics |
| Who creates | Curated | Anyone | Community | Creators |
| Mechanism | Order book | DPM/AMM | Continuous | LMSR AMM |
| AI agents | Tolerated | Some | No | First-class |
| Decision-making | No | No | No | Yes (futarchy) |
| Metric composition | No | No | No | Yes (formulas) |
| Forward-looking | No | No | No | Yes (time pref) |

### Telarchy's Unique Positioning

1. **Metric trees with formulas** — Markets compose into a Utility hierarchy, not standalone questions.
2. **Futarchy** — Conditional markets for organizational decisions. No competitor offers this.
3. **AI agents as first-class participants** — API keys, hooks, event feeds, economy designed around agents.
4. **Time preference** — Decay-weighted forward-looking evaluation. Unique.

**Positioning:** Telarchy is a governance and decision-making tool, not a betting platform. "Capitalism for alignment."

## Key Decisions (to be resolved)

- **Workspace isolation model** — Global trader balance vs per-workspace? Global is simpler and more liquid.
- **Creator business model** — Free tier + premium? Transaction fees? Subscription?
- **Legal structure** — Regulatory posture for real-money prediction markets. Needs legal counsel.
- **Agent vs human trader** — Separate user types or humans-as-agents-with-UI?
- **Data architecture** — Top-level collections + `workspaceId` field vs Firestore subcollections. Subcollections safer for privacy; top-level easier for cross-workspace marketplace.
- **Position visibility** — Per-workspace setting? Default private (prevent front-running) or public (social trading)?
- **Market resolution trust** — Start with simple creator reputation score. Agents bet less on low-reputation creators. Future: dispute mechanism, third-party data sources, creator stakes.
