# Implementation Plan

Detailed step-by-step plan for the go-to-market work outlined in [go-to-market.md](go-to-market.md).

## Phase 0: Immediate Fixes (before any refactor)

These are bugs and security issues in the current codebase that should be fixed first. They're independent of multi-tenancy and each is a focused change.

### 0.1 Fix trade race condition

**Problem:** `POST /predictions/trade` reads market state, computes LMSR cost, then writes via `batch.commit()`. Two concurrent trades on the same market both read stale `shares` and produce incorrect results.

**Fix:** Wrap the entire trade in `db().runTransaction()`. Read market, agent, and position docs inside the transaction. Compute cost. Write all updates inside the transaction. Firestore will retry on contention.

**Files:**
- `functions/src/routes/predictions.ts` (lines 22-139) — replace `batch` with `runTransaction`

**Approach:**
1. Move all reads (`marketRef.get()`, `agentRef.get()`, `posRef.get()`) inside the transaction callback
2. Move all validation (balance check, share check) inside the transaction
3. Replace `batch.update/set` with `tx.update/set`
4. Keep the `emitEvent` call outside the transaction (it's fire-and-forget)
5. Return the response data from the transaction and send it after

**Risk:** Firestore transactions retry on contention, which means the LMSR computation runs again. This is fine since it's deterministic given the current state.

### 0.2 CORS lockdown

**Problem:** `cors({ origin: true })` allows any origin.

**Fix:** Restrict to known origins.

**Files:**
- `functions/src/index.ts` (line 30)

**Approach:**
```typescript
const allowedOrigins = [
  process.env.ALLOWED_ORIGIN,          // Firebase Hosting domain
  'http://localhost:5173',              // Vite dev
  'http://localhost:5000',              // Firebase emulator
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS'));
  }
}));
```

Add `ALLOWED_ORIGIN` to the deployment config.

### 0.3 Rate limiting

**Problem:** No rate limiting on any endpoint.

**Fix:** Add `express-rate-limit` (already in dependencies).

**Files:**
- `functions/src/index.ts` — add rate limiter middleware

**Approach:**
- Global: 100 requests/minute per IP
- Trade endpoint: 30 requests/minute per agent
- Registration/waitlist: 5 requests/minute per IP
- Apply before route handlers

### 0.4 Master API key hardening

**Problem:** `API_KEY` in `.env`, plain `===` comparison.

**Fix:**
1. Move `API_KEY` to Firebase Secret Manager
2. Use `crypto.timingSafeEqual` for comparison

**Files:**
- `functions/src/middleware/auth.ts` (line 46)
- `functions/src/index.ts` (add to `secrets` array)

### 0.5 Input validation ✓ Done

**Problem:** `agentId`, content fields, `txHash` have no length/format limits.

**Fix:** Add validation helpers, apply at route level.

**Files:**
- `functions/src/lib/validation.ts` — `validateAgentId`, `validateContent`, `validateTxHash`, plus `toUnits`/`fromUnits`/`CREDIT_PRECISION` for nanocredit storage and `sufficientBalance()`
- `functions/src/routes/agents.ts` — apply to registration, spend, deposit
- `functions/src/routes/tasks.ts` — apply to task creation, messages
- `functions/src/routes/predictions.ts` — apply to trade

**Rules:**
- `agentId`: 1-64 chars, alphanumeric + hyphens + underscores
- `content`/`description`/`title`: max 10,000 chars
- `txHash`: must match `/^0x[a-fA-F0-9]{64}$/`

---

## Phase 1: Multi-Tenancy Foundation

This is the biggest change. The goal is to go from single-tenant to multi-tenant without breaking existing functionality. The existing data becomes "workspace 0" (or a named default workspace).

### 1.1 Data model: Workspace document and subcollections

**New Firestore structure:**

```
workspaces/{workspaceId}/
  ├── info                    (workspace metadata — single doc at workspaces/{id})
  ├── metrics/{metricId}
  ├── metricLogs/{logId}
  ├── updates/{updateId}
  ├── markets/{marketId}
  ├── positions/{positionId}
  ├── trades/{tradeId}
  ├── liquidityEvents/{eventId}
  ├── tasks/{taskId}
  │   └── messages/{messageId}
  ├── events/{eventId}
  ├── agents/{agentId}
  └── _locks/{lockId}           (market refresh lock, etc.)

// Global (not workspace-scoped):
users/{uid}                     (Firebase Auth UID → user profile, workspace memberships)
agentApiKeys/{hash}             (global lookup — contains workspaceId + agentId)
waitlist/{email}
deposits/{id}                   (references workspaceId)
withdrawals/{id}                (references workspaceId)
_system/economy                 (global economy params)
```

**Workspace document (`workspaces/{id}`):**
```typescript
{
  id: string;
  name: string;
  createdBy: string;            // Firebase Auth UID of creator
  createdAt: Timestamp;
  visibility: 'public' | 'unlisted' | 'private';
  creditValueUsd: number;       // per-workspace economy (or inherit global)
  settings: {
    positionVisibility: 'owner-only' | 'members' | 'public';
    autoApproveAgents: boolean;
  };
}
```

**User document (`users/{uid}`):**
```typescript
{
  uid: string;
  email: string;
  createdAt: Timestamp;
  workspaces: {
    [workspaceId: string]: {
      role: 'owner' | 'admin' | 'trader' | 'viewer';
      joinedAt: Timestamp;
    };
  };
}
```

**Why subcollections over top-level + field:**
- Structural isolation — querying `workspaces/A/markets` cannot return workspace B's markets
- No risk of forgetting a `.where('workspaceId', '==', ...)` filter
- Cross-workspace queries (public marketplace) use Firestore collection group queries
- Cleaner migration path — old data moves into `workspaces/default/...`

**Files to create:**
- `functions/src/lib/workspace.ts` — workspace-scoped Firestore helpers

### 1.2 Workspace-scoped database helpers

Create a helper layer that all routes use instead of raw `db().collection()` calls.

**File:** `functions/src/lib/workspace.ts`

```typescript
import { db } from './db';

export function wsCollection(workspaceId: string, name: string) {
  return db().collection(`workspaces/${workspaceId}/${name}`);
}

export function wsDoc(workspaceId: string, collection: string, docId: string) {
  return db().doc(`workspaces/${workspaceId}/${collection}/${docId}`);
}

export function wsRef(workspaceId: string) {
  return db().doc(`workspaces/${workspaceId}`);
}
```

All existing `db().collection('markets')` calls become `wsCollection(workspaceId, 'markets')`.

### 1.3 Auth rework

**Changes to `AuthInfo` type:**

```typescript
interface AuthInfo {
  role: 'platform-admin' | 'owner' | 'admin' | 'trader' | 'agent' | 'viewer';
  uid?: string;            // Firebase Auth UID (human users)
  agentId?: string;        // Agent ID (API key auth)
  workspaceId?: string;    // Resolved workspace (from URL or agent)
}
```

**Changes to `authMiddleware`:**

The middleware resolves identity only. A new `workspaceMiddleware` resolves and validates workspace access.

1. Master API key → `role: 'platform-admin'`
2. Firebase token → look up `users/{uid}` to get user profile. Don't enforce admin — any registered user can auth.
3. Agent API key → look up `agentApiKeys/{hash}` which now contains `workspaceId`. Set both `agentId` and `workspaceId`.

**New `workspaceMiddleware`:**

Runs after `authMiddleware` on workspace-scoped routes. Resolves `workspaceId` from `req.params.workspaceId` (or header). Checks membership in `users/{uid}.workspaces[workspaceId]`. Sets `req.auth.workspaceId` and workspace-specific role.

**New role checks:**

```typescript
// Existing (rename)
requireRole('platform-admin')           // Platform-wide admin

// New
requireWorkspaceRole('owner', 'admin')  // Workspace owner or admin
requireWorkspaceMember()                // Any workspace member
requireWorkspaceTrader()                // Can trade (trader, admin, owner)
```

**Files to change:**
- `functions/src/types.ts` — update `AuthInfo`
- `functions/src/middleware/auth.ts` — rework auth paths
- `functions/src/middleware/roles.ts` — add workspace role checks
- `functions/src/middleware/workspace.ts` (new) — workspace resolution

### 1.4 API route restructuring

Workspace-scoped endpoints move under `/api/w/:workspaceId/`:

```
/api/w/:workspaceId/metrics
/api/w/:workspaceId/markets
/api/w/:workspaceId/predictions/trade
/api/w/:workspaceId/agents
/api/w/:workspaceId/tasks
/api/w/:workspaceId/events
```

Global endpoints stay at `/api/`:

```
/api/help
/api/status
/api/auth/register          (new — user registration)
/api/auth/me                (new — current user profile)
/api/workspaces             (new — list/create workspaces)
/api/marketplace            (new — public market browse)
/api/waitlist
```

**Files to change:**
- `functions/src/index.ts` — mount workspace router under `/api/w/:workspaceId`
- All route files in `functions/src/routes/` — update to use `req.auth.workspaceId` and `wsCollection()`
- `functions/src/routes/auth.ts` (new) — user registration, profile
- `functions/src/routes/workspaces.ts` (new) — workspace CRUD
- `functions/src/routes/marketplace.ts` (new) — public market browse

**Migration strategy for routes:**
1. Create the new workspace-scoped router structure
2. Update all existing route handlers to read `workspaceId` from `req.auth`
3. Replace every `db().collection('X')` with `wsCollection(req.auth.workspaceId, 'X')`
4. Keep old `/api/...` routes working temporarily (they resolve to default workspace)

### 1.5 Update all route handlers

This is the bulk of the work. Every route handler that accesses Firestore needs to use workspace-scoped helpers.

**Collection access points to update (from the inventory):**

| Collection | Files to update |
|---|---|
| `agents` | `routes/agents.ts`, `routes/predictions.ts`, `routes/system.ts`, `services/tasks.ts`, `services/markets.ts`, `services/predictions.ts` |
| `markets` | `routes/predictions.ts`, `routes/metrics.ts`, `services/tasks.ts`, `services/metrics.ts`, `services/markets.ts`, `services/predictions.ts` |
| `positions` | `routes/predictions.ts`, `services/tasks.ts`, `services/markets.ts`, `services/predictions.ts` |
| `trades` | `routes/predictions.ts`, `services/tasks.ts` |
| `metrics` | `routes/metrics.ts`, `services/tasks.ts`, `services/metrics.ts`, `services/markets.ts` |
| `metricLogs` | `services/metrics.ts` |
| `updates` | `routes/metrics.ts`, `services/metrics.ts` |
| `events` | `services/events.ts` |
| `liquidityEvents` | `routes/predictions.ts`, `services/metrics.ts`, `services/markets.ts` |
| `tasks` | `routes/predictions.ts`, `routes/tasks.ts`, `services/tasks.ts`, `services/predictions.ts` |

**Approach:** Work through each service file first (they're shared), then each route file. For each:
1. Add `workspaceId` parameter to all exported functions
2. Replace `db().collection('X')` with `wsCollection(workspaceId, 'X')`
3. Replace `db().doc('_system/...')` with `wsDoc(workspaceId, '_locks', '...')`
4. Update callers to pass `workspaceId`

**Order of changes (dependency-driven):**
1. `functions/src/lib/workspace.ts` — create helpers
2. `functions/src/services/events.ts` — simplest, only 1 collection
3. `functions/src/services/metrics.ts` — metrics, metricLogs, updates, markets, liquidityEvents
4. `functions/src/services/markets.ts` — markets, positions, agents, metrics, liquidityEvents, locks
5. `functions/src/services/predictions.ts` — positions, agents, markets, tasks
6. `functions/src/services/tasks.ts` — tasks, markets, positions, agents, trades, metrics, locks
7. `functions/src/routes/metrics.ts` — metrics, updates, markets
8. `functions/src/routes/predictions.ts` — markets, agents, positions, trades, liquidityEvents, tasks
9. `functions/src/routes/tasks.ts` — tasks, messages
10. `functions/src/routes/agents.ts` — agents, agentApiKeys, deposits, withdrawals
11. `functions/src/routes/events.ts` — events, system
12. `functions/src/routes/system.ts` — economy, agents, deleteCollection calls

### 1.6 Data migration script

Migrate existing data from top-level collections into `workspaces/default/...`.

**File:** `scripts/migrate-to-workspaces.ts`

**Steps:**
1. Create `workspaces/default` document with current admin as owner
2. For each collection (`metrics`, `markets`, `positions`, `trades`, `agents`, `events`, `tasks`, `metricLogs`, `updates`, `liquidityEvents`):
   - Read all documents
   - Write each to `workspaces/default/{collection}/{docId}`
   - Verify counts match
3. Create `users/{uid}` document for the current admin with `workspaces: { default: { role: 'owner' } }`
4. Update `agentApiKeys` to include `workspaceId: 'default'`
5. Do NOT delete old collections yet — keep as backup until verified

### 1.7 Frontend: workspace context

**URL structure change:**

```
/w/:workspaceId/metrics
/w/:workspaceId/agents
/w/:workspaceId/markets
/w/:workspaceId/tasks
```

Public routes stay at root: `/`, `/login`, `/signup`, `/marketplace`, `/waitlist`.

**Files to change:**

- `src/App.tsx` — add workspace routes under `/w/:workspaceId/`
- `src/lib/api.ts` — add `workspaceId` to all workspace-scoped API calls (change base URL to `/api/w/${workspaceId}/...`)
- `src/hooks/useAuth.ts` — add workspace context (current workspace, list of workspaces)
- `src/hooks/useWorkspace.ts` (new) — read `workspaceId` from URL params, fetch workspace info
- `src/components/RequireAuth.tsx` — add workspace resolution and redirect
- `src/pages/RootRedirect.tsx` — redirect to `/w/${defaultWorkspace}/metrics` or workspace picker

### 1.8 Integration tests for tenant isolation

**File:** `functions/src/__tests__/tenant-isolation.test.ts`

**Tests:**
1. Create market in workspace A → query markets in workspace B → returns empty
2. Create agent in workspace A → query agents in workspace B → returns empty
3. Trade in workspace A → query positions in workspace B → returns empty
4. Agent key in workspace A → cannot access workspace B endpoints
5. Public market in workspace A → visible in marketplace query
6. Private market in workspace A → invisible in marketplace query

---

## Phase 2: Creator MVP

### 2.1 User registration and workspace creation

**Backend:**

- `POST /api/auth/register` — Create Firebase Auth user + `users/{uid}` doc. No workspace yet.
- `POST /api/workspaces` — Create workspace. Caller becomes owner. Creates default Utility metric.
- `GET /api/workspaces` — List workspaces the user is a member of.
- `GET /api/auth/me` — Return user profile with workspaces.
- `DELETE /api/auth/me` — Self-service account deletion (GDPR).
- `GET /api/auth/me/export` — Data export (GDPR).

**Files:**
- `functions/src/routes/auth.ts` (new)
- `functions/src/routes/workspaces.ts` (new)

**Frontend:**

- `src/pages/SignupPage.tsx` (new) — email/password registration
- `src/pages/CreateWorkspacePage.tsx` (new) — name workspace, define initial Utility metric

### 2.2 Onboarding wizard

After workspace creation, guide the creator through setting up their metric tree.

**Frontend:**

- `src/pages/OnboardingPage.tsx` (new) — multi-step wizard:
  1. "What's your top-level goal?" → names the Utility metric
  2. "Break it into components" → add sub-metrics with formulas
  3. "What can you measure?" → add leaf metrics with ranges
  4. "Enable predictions" → toggle time preference on key metrics
  5. "Invite traders" → share link or set visibility to public

**Backend:** No new endpoints needed — uses existing metric CRUD and workspace settings.

### 2.3 Workspace settings and member management

**Backend:**

- `PUT /api/w/:workspaceId/settings` — Update visibility, position visibility, auto-approve
- `POST /api/w/:workspaceId/members` — Invite member (by email, with role)
- `GET /api/w/:workspaceId/members` — List members
- `PUT /api/w/:workspaceId/members/:uid` — Change member role
- `DELETE /api/w/:workspaceId/members/:uid` — Remove member

**Frontend:**

- `src/pages/WorkspaceSettingsPage.tsx` (new) — settings, member list, invite form
- Add settings gear icon to Header

### 2.4 Creator dashboard enhancements

Update existing pages to show creator-relevant analytics:

- `MetricsPage` — add "getting started" empty state when no metrics exist
- `MarketsPage` — add market analytics (total volume, unique traders, consensus trends)
- `AgentsPage` — add agent activity summary (trades/day, PnL distribution)

---

## Phase 3: Trader MVP

### 3.1 Public marketplace

**Backend:**

- `GET /api/marketplace` — Returns active markets from all public workspaces. Uses Firestore collection group query on `markets` where parent workspace has `visibility: 'public'`. Includes workspace name, metric name, consensus, volume.
- `GET /api/marketplace/:workspaceId/:marketId` — Public market detail page.

**Frontend:**

- `src/pages/MarketplacePage.tsx` (new) — browse public markets, search/filter by workspace, metric, date range
- `src/pages/MarketDetailPage.tsx` (new) — single market view with consensus chart, trade history, "place a bet" CTA

### 3.2 Trader signup and workspace joining

**Backend:**

- Trader signs up via `POST /api/auth/register` (same as creator).
- Joins a public workspace: `POST /api/w/:workspaceId/join` — adds membership with `role: 'trader'`.
- For private workspaces: invite-only via member invite flow.

**Frontend:**

- `src/pages/SignupPage.tsx` — shared with creators, but post-signup redirect differs (marketplace vs workspace creation)
- Update `MarketDetailPage` — "Sign up to trade" CTA for unauthenticated users
- After signup + join, redirect to trading view

### 3.3 Trader-facing UI

Modify existing pages to show a trader-appropriate view based on workspace role.

**Frontend changes:**

- `MarketsPage` — if role is `trader`:
  - Hide: create market form, resolve/void/delete buttons, refresh, bulk liquidity
  - Show: trading panel, own positions, PnL
  - Add: portfolio summary at top (total balance, open positions, total PnL)
- `MetricsPage` — if role is `trader`:
  - Hide: add/edit/delete metric buttons
  - Show: read-only metric tree with consensus values
- `AgentsPage` — if role is `trader`:
  - Show: only own agent(s) and their balance/positions
  - Hide: approve, credit, role management
- `TasksPage` — if role is `trader`:
  - Show: task list with conditional market inspection
  - Hide: approve/decline (unless workspace allows trader task proposals)

**Implementation:** Add `role` to `useWorkspace` hook. Use conditional rendering in existing components rather than creating separate trader pages.

### 3.4 Wallet connect and deposit/withdraw UI

**Frontend:**

- `src/components/WalletConnect.tsx` (new) — connect MetaMask/WalletConnect/Coinbase Wallet
- `src/components/DepositWithdraw.tsx` (new) — deposit USDC to treasury, withdraw to wallet
- Integrate into a "Balance" section in the Header or a dedicated `/w/:workspaceId/wallet` page

**Dependencies:** `ethers` (already in backend), `@web3modal/ethers` or `wagmi` + `viem` for frontend wallet connection.

**Backend:** Existing deposit/withdraw endpoints work. May need minor adjustments for workspace scoping.

---

## Phase 4: Growth

### 4.1 Leaderboard

- `GET /api/w/:workspaceId/leaderboard` — Top agents by PnL in a workspace
- `GET /api/marketplace/leaderboard` — Top agents globally across public workspaces
- `src/pages/LeaderboardPage.tsx` (new) or section in MarketsPage

### 4.2 Agent developer portal

- Static docs site (could be a section of the main site or a separate subdomain)
- Interactive API explorer (Swagger/OpenAPI spec generated from route definitions)
- Example agents in Python and JavaScript
- Sandbox mode: workspace with play money for testing

### 4.3 Notifications

- `functions/src/services/notifications.ts` (new) — send emails via SendGrid/Resend
- Trigger on: market resolution, large price moves, new task proposals, agent approval
- User notification preferences in `users/{uid}.notifications`

### 4.4 Billing

- Stripe integration for workspace subscriptions
- Free tier: 1 workspace, N markets, M agents
- Paid tier: unlimited markets, priority support, CMEK
- `functions/src/routes/billing.ts` (new)
- `src/pages/BillingPage.tsx` (new)

---

## Implementation Order Summary

```
Phase 0 (1-2 days each, independent):
  0.1 Trade race condition fix
  0.2 CORS lockdown
  0.3 Rate limiting
  0.4 Master API key hardening
  0.5 Input validation

Phase 1 (the big refactor):
  1.1 Data model design (workspace doc, subcollections)
  1.2 Workspace-scoped db helpers
  1.3 Auth rework (middleware, roles, workspace resolution)
  1.4 API route restructuring
  1.5 Update all route handlers (largest step — 12 files)
  1.6 Data migration script
  1.7 Frontend workspace context
  1.8 Integration tests for tenant isolation

Phase 2 (creator MVP):
  2.1 User registration + workspace creation
  2.2 Onboarding wizard
  2.3 Workspace settings + member management
  2.4 Creator dashboard enhancements

Phase 3 (trader MVP, parallel with Phase 2):
  3.1 Public marketplace
  3.2 Trader signup + workspace joining
  3.3 Trader-facing UI (conditional rendering)
  3.4 Wallet connect + deposit/withdraw UI

Phase 4 (growth, after launch):
  4.1 Leaderboard
  4.2 Agent developer portal
  4.3 Notifications
  4.4 Billing
```

## Privacy and Legal Checklist (parallel with Phase 1-2)

- [ ] Write privacy policy
- [ ] Write terms of service
- [ ] Implement `DELETE /api/auth/me` (account deletion)
- [ ] Implement `GET /api/auth/me/export` (data export)
- [ ] Add admin audit trail collection
- [ ] Document GCP region in privacy policy
- [ ] Consult lawyer on prediction market regulations
