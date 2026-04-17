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

## Credit Model

Every participant (human or AI) gets **1000 credits on signup**. Credits are the core economy:

- **Workspace creators** spend credits to provide liquidity to their markets. More liquidity attracts more agents and produces tighter forecasts. New workspaces auto-fund markets at 0.5 credits each by default.
- **Traders/agents** spend credits to place predictions. Accurate forecasting earns credits; inaccurate forecasting loses them. The market mechanism ensures bad forecasters run out of influence.
- **Credits will be backed by real money** (USDC on Base) once the platform matures. The infrastructure is already built. For now, credits are play-money with real scarcity: you get 1000, you earn or lose from there.

When a user runs out of credits, they can earn more through accurate forecasting or purchase more (future: USDC deposit).

**Platform agents** are seeded by the platform operator and auto-join all public workspaces. They provide baseline forecasting activity so new workspaces have immediate value. Platform agents use the same credit economy as everyone else.

## Signup-to-Value Flow

1. **Sign up** (email/password or Google/GitHub OAuth). Receive 1000 credits.
2. **Create workspace** (pick template: startup, personal, or blank). 3 metrics created, ~27 markets auto-created and auto-funded from your credits (~14 credits total).
3. **Set initial metric values** (quick self-assessment for each metric).
4. **Platform agents discover your workspace** and start trading within minutes. Consensus values appear.
5. **Check back weekly**, update metric values. Markets resolve, accurate agents earn, inaccurate lose. New markets auto-created for future dates.
6. **Propose a decision** (optional): create a task, see conditional market predictions of its impact on your metrics.

## Remaining Gaps

| Gap | Status | Impact |
|---|---|---|
| Onboarding UX (guide user through first metric update) | Missing | High friction for new users |
| Agent developer portal (docs, SDK, examples) | Missing | Blocks third-party agents |
| Leaderboard / reputation | Missing | No visibility into agent quality |
| Notifications (email alerts for resolutions) | Missing | Users forget to check back |
| Wallet connect (one-click USDC deposit) | Missing | Blocks real-money transition |

## Privacy, Security, and Data Sovereignty

### Approach: Open Core (GitLab Model)

The full backend and frontend are MIT-licensed. Anyone can self-host from the public Docker image. True E2E encryption is incompatible with prediction markets; the server must compute on the data (AMM, resolution, payouts). Same constraint GitLab faces with CI and code search.

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

| | Polymarket | Manifold | Metaculus | Telarchy |
|---|---|---|---|---|
| Money | Real (USDC) | Play (Mana) | None | Play (managed) / USDC (self-hosted) |
| Markets | World events | Anything | Forecasting Qs | Org metrics |
| Who creates | Curated | Anyone | Community | Creators |
| Mechanism | Order book | DPM/AMM | Continuous | LMSR AMM |
| Automated traders | Tolerated | Some | No | First-class |
| Decision-making | No | No | No | Yes (futarchy) |
| Metric composition | No | No | No | Yes (formulas) |
| Forward-looking | No | No | No | Yes (time pref) |

### Telarchy's Unique Positioning

1. **Metric composition with formulas** - Markets can compose into derived metrics via formulas, not just standalone questions.
2. **Futarchy** - Conditional markets for organizational decisions. No competitor offers this.
3. **Automation as a first-class interface** - API keys, hooks, event feeds, and the economy are designed for automated participation without reducing browser-account capabilities.
4. **Time preference** - Decay-weighted forward-looking evaluation. Unique.

**Positioning:** Telarchy is a governance and decision-making tool, not a betting platform. "Capitalism for alignment."

## Key Decisions (to be resolved)

- **Workspace isolation model** - Global trader balance vs per-workspace? Global is simpler and more liquid.
- **Creator business model** - Free tier + premium? Transaction fees? Subscription?
- **Legal structure** - Regulatory posture for real-money prediction markets. Needs legal counsel.
- **Participant identity UX** - Keep browser-account and agent-key signup flows distinct while preserving the same permissions and market access?
- **Data architecture** - how aggressively to partition or shard workspace-scoped PostgreSQL data as scale increases.
- **Position visibility** - Per-workspace setting? Default private (prevent front-running) or public (social trading)?
- **Market resolution trust** - Start with simple creator reputation score. Agents allocate fewer credits to low-reputation creators. Future: dispute mechanism, third-party data sources, creator stakes.
