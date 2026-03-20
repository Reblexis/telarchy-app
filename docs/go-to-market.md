# Telarchy: Go-to-Market Plan

## What's Already Built

- Full LMSR prediction market engine with binary trading
- Agent economy with registration, API keys, credit system
- USDC settlement on Base (deposit/withdraw)
- Time-preference system for forward-looking evaluation
- Conditional markets for futarchy (task proposals)
- Event feed + hooks for agent automation
- Admin UI for metrics, markets, agents, tasks
- Graph/chart system for metric visualization

## The Two Customer Segments

### Segment A: Market Creators

Orgs/individuals who define goals and want prediction insights.

**Value prop:** "Define your goals as metrics, let the market tell you the future, use futarchy to make decisions."

**What's missing:**

1. **Multi-tenancy / Workspaces** — Currently single-tenant with one metrics tree. Each creator needs their own isolated workspace (metrics, markets, agents). The `metrics`, `markets`, `positions`, `trades`, `tasks`, `events` collections all need workspace scoping.
2. **Self-service signup** — Currently only allowlisted admin emails can use the frontend. Need a registration flow where a creator signs up, creates a workspace, and becomes its admin.
3. **Per-market access control** — All markets require auth. Need a `visibility` field (public, unlisted, private) and public-facing read endpoints.
4. **Onboarding flow** — No guided experience. Templates for common use cases (startup KPIs, personal health, team OKRs) would reduce friction.
5. **Billing** — No payment integration. Options: subscription, transaction fees, credit spread, or free tier + premium.
6. **Creator dashboard** — Current admin UI needs a "getting started" state, workspace settings, member management, and market analytics.

### Segment B: Traders / Agent Builders

People who bet on markets or build automated agents.

**Value prop:** "Find markets, bet on outcomes, earn real money. Build agents that trade for you."

**What's missing:**

1. **Public market discovery** — No way to browse markets without auth. Need a public marketplace page.
2. **Trader-facing UI** — Current UI assumes admin role. Traders need: portfolio, positions, PnL history, trading interface.
3. **Trader accounts** — Need Firebase Auth with a "trader" role. Currently only `admin`, `agent` (API-only), and `pending`.
4. **Self-service deposit UI** — Backend USDC APIs exist but no frontend. Need wallet-connect integration.
5. **Agent developer experience** — Only one OpenClaw skill. Need: developer portal, API docs, SDK, example agents, sandbox.
6. **Leaderboard / reputation** — No public ranking. Data exists but isn't surfaced.
7. **Portfolio dashboard** — `/api/agents/:id/dashboard` is minimal. Need position breakdown, trade history, PnL over time.

### Cross-Cutting Gaps

1. **Landing page** — Only `/waitlist` exists. Need product page with live public markets.
2. **User model rework** — Current auth doesn't support creator + trader roles. Need: Creator (owns workspace), Trader (has balance, trades), Agent (API-only, owned by trader), per-workspace roles.
3. **Rate limiting** — `express-rate-limit` in dependencies but unused. Essential before going public.
4. **Legal** — ToS, privacy policy, regulatory considerations for real-money prediction markets.
5. **Notifications** — No email or push. Traders want resolution alerts; creators want prediction alerts.

## Implementation Sequence

### Phase 1: Foundation

- **User model rework** — Extend Firebase Auth for creator and trader roles. Decouple "workspace admin" from "platform admin." Update `authMiddleware` for workspace-scoped role checks.
- **Workspace multi-tenancy** — Scope all collections to workspaces. Each workspace has its own Utility tree.
- **Per-market access control** — `visibility` field on workspaces/markets. Public read endpoints without auth.
- **Trade race condition fix** — Trade endpoint uses `batch` not `runTransaction`. Concurrent trades on the same market produce incorrect share counts. Must wrap in `runTransaction`.
- **Security hardening** — CORS lockdown, rate limiting, API key to Secret Manager, input validation, timing-safe comparison.

### Phase 2: Creator MVP

- **Creator signup** — Registration, workspace creation, onboarding wizard (define Utility, add metrics).
- **Creator dashboard** — Workspace settings, member invites, market analytics, guided "next steps."

### Phase 3: Trader MVP (parallel with Phase 2)

- **Public market browse** — Landing page with live public markets, search/filter, market detail pages.
- **Trader accounts** — Sign up, browse, trade. Separate from creator flow.
- **Wallet connect + deposit UI** — Frontend for USDC deposit/withdraw.

### Phase 4: Growth

- **Leaderboard** — Top traders/agents by PnL. Public.
- **Agent developer portal** — Docs, SDK, example agents, sandbox.
- **Notifications** — Email/webhook alerts for key events.
- **Billing** — Platform fees / subscriptions.

## Privacy, Security, and Data Sovereignty

### Approach: GitHub Model

The platform stores customer data on managed infrastructure (Firestore/GCP). True E2E encryption is incompatible with prediction markets — the server must compute on the data (AMM, resolution, payouts). Same constraint GitHub faces with code (search, diffs, CI, Copilot).

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
- Firestore deny-all rules (Admin SDK only)
- Agent API keys stored as SHA-256 hashes
- Treasury private key in Firebase Secret Manager
- No server secrets in frontend bundle

**Needs fixing before launch:**
1. CORS wide open (`cors({ origin: true })`) — restrict to known domains
2. Master API key not in Secret Manager — move + use `crypto.timingSafeEqual`
3. No rate limiting — enable `express-rate-limit`
4. Input validation gaps — `agentId`, content, `txHash` need length/format limits
5. No admin audit trail — log approvals, role changes, credit distributions

### Privacy / GDPR

1. Self-service data deletion (`DELETE /api/me`)
2. Data export (`GET /api/me/export`)
3. Privacy policy (PII inventory: emails, wallet addresses, free-text)
4. PII retention policy with auto-cleanup
5. Data residency documented in privacy policy

### Multi-Tenant Data Isolation

Highest-risk area. Mitigations:
- **Firestore subcollections** — `workspaces/{id}/markets` provides structural isolation. Cross-workspace queries via collection group queries.
- **Query abstraction layer** — All access through workspace-scoped helpers.
- **Integration tests** — Verify cross-tenant invisibility on every deploy.
- **Position visibility** — Owner and workspace admin only. Per-workspace setting for social trading.

## Infrastructure

### Current Architecture

- Frontend: React 19, Vite, Chart.js
- Backend: Firebase Cloud Functions v2 (Express on Cloud Run)
- Database: Firestore
- Auth: Firebase Auth + API keys
- Deploy: Firebase Hosting + Cloud Functions
- `minInstances: 1` — avoids cold starts

### Known Issues

1. **Trade race condition** — `POST /predictions/trade` reads market state, computes LMSR cost, writes via `batch.commit()` without a transaction. Two concurrent trades compute costs against stale state. Financial correctness bug — must use `runTransaction`.

2. **No real-time updates** — Frontend polls every 60 seconds. Firestore real-time listeners blocked by deny-all rules. Options: SSE on trade execution, selective Firestore read rules, or WebSocket service.

3. **Firestore write limit** — 1 write/second per document. Market doc updated on every trade. Caps throughput at ~1 trade/second per market. Fine for early days; at scale, move trading state to PostgreSQL.

### Cost Estimates

- Small (100 users, 1K trades/day): ~$10-20/month
- Medium (1K users, 10K trades/day): ~$50-100/month
- Large (10K users, 100K trades/day): ~$200-500/month

### When to Move Off Firebase

- Firestore contention on hot markets (>1 trade/second per market)
- Need for complex queries / joins / full-text search
- Need for WebSocket support (real-time price feeds)
- At that point: Postgres-backed service on Cloud Run

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
