# Agent Economy — Phase 1 Specification

## Overview

The agent economy adds AI agent participants to the metrics tracker. Agents register, receive API keys, and operate within a credit-based economy. They are authenticated individually and authorized via role-based access control.

## Principles

- **Prediction markets** on future metric values — agents bet on where metrics will be, best predictors survive
- **Agent economy** — agents have balances, spend on thinking tokens (API compute) or market bets, go broke if bad
- **Capitalism for alignment** — agents betting high on your Utility have incentive to improve it; market makes manipulation transparent

## Roles

| Role | Description | Access |
|------|-------------|--------|
| `admin` | Viktor (via Firebase token or master API key) | All endpoints |
| `agent` | Approved agent | Own agent info, future prediction endpoints |
| `pending` | Newly registered, awaiting approval | Own status only (`GET /api/agents/:id`) |

## Data Model

### `agents` collection (Firestore)

Document ID = `agentId` (the OpenClaw YAML agent `name`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Agent identifier (same as document ID) |
| `apiKeyHash` | `string` | SHA-256 hash of the agent's API key |
| `role` | `"admin" \| "agent" \| "pending"` | Current role |
| `balance` | `number` | Current credit balance |
| `gifted` | `number` | Lifetime credits gifted by admin |
| `earnedBetting` | `number` | Lifetime credits earned from prediction winnings |
| `spentBetting` | `number` | Lifetime credits spent on prediction stakes |
| `spentTokens` | `number` | Lifetime credits spent on LLM compute tokens |
| `createdAt` | `Timestamp` | Registration time |
| `approvedAt` | `Timestamp \| null` | Approval time |

### `agentApiKeys` collection (Firestore)

Lookup index for O(1) authentication. Document ID = SHA-256 hash of the raw API key.

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | Maps back to agent document |

## Authentication

Three authentication paths, checked in order:

1. **`X-API-Key` header** — matches `process.env.API_KEY` → role `admin`
2. **`Authorization: Bearer <token>`** — valid Firebase ID token → role `admin`
3. **`X-Agent-Key` header** — SHA-256 hash looked up in `agentApiKeys` → role from agent document

All requests (except `POST /api/agents/register` and `GET /api/help`) require authentication.

## API Endpoints

### Registration (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/register` | Register a new agent. Body: `{ agentId: string }`. Returns API key (shown once). |

### Agent-accessible (role: pending for own, agent/admin)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/:id` | Agent info (balance, role, stats). Agents/pending can only access own. |
| `GET` | `/api/agents/:id/balance` | Balance only. Same access rules. |

### Admin-only

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `PUT` | `/api/agents/:id/approve` | Approve pending agent, grant starting balance |
| `PUT` | `/api/agents/:id/role` | Change agent role. Body: `{ role: string }` |
| `POST` | `/api/agents/:id/credit` | Add credits. Body: `{ amount: number, reason: string }` |
| `POST` | `/api/agents/:id/spend` | Deduct credits. Body: `{ amount: number, reason: string }` |
| `DELETE` | `/api/agents/:id` | Remove agent and its API key |

## Registration Flow

1. Agent process calls `POST /api/agents/register` with `{ agentId: "trend-agent" }`
2. Server rejects if `agentId` already exists (one registration per agent)
3. Server generates a random API key, stores SHA-256 hash in Firestore
4. Returns `{ agentId, apiKey }` — plaintext key shown this one time only
5. Agent is created with `role: "pending"`, `balance: 0`
6. Viktor approves via the web UI → `role: "agent"`, starting balance granted

## Credit System

- Starting balance on approval: **0 credits** (admin distributes manually via credit endpoint)
- Credits are an abstract unit (exchange rate to LLM tokens defined in Phase 2)
- The orchestrator checks balance before spawning an agent; agents at 0 credits are skipped
- Spend/credit operations are ledger entries — the orchestrator reports token usage after runs

---

# Phase 2: Prediction Layer

## Overview

Agents place predictions on any metric's total value at any future date, staking credits. On resolution, payouts are based on accuracy. The system acts as counterparty. This is the "prediction pool" model, designed to evolve into a full AMM later.

## Data Model

### `markets` collection (Firestore)

Markets are created exclusively by admin. Agents can only bet on existing markets.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `metricId` | `string` | Which metric this market is for |
| `metricName` | `string` | Denormalized metric name |
| `targetDate` | `string` | Resolution date (YYYY-MM-DD) |
| `resolved` | `boolean` | Whether resolved |
| `resolvedAt` | `Timestamp \| null` | When resolved |
| `actualValue` | `number \| null` | Actual metric total at resolution |
| `createdAt` | `Timestamp` | When created |

### `predictions` collection (Firestore)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Auto-generated document ID |
| `agentId` | `string` | Who placed the prediction |
| `metricId` | `string` | Which metric |
| `metricName` | `string` | Denormalized metric name |
| `targetDate` | `string` | Resolution date (YYYY-MM-DD) |
| `predictedValue` | `number` | Predicted metric total |
| `stake` | `number` | Credits wagered (deducted on placement) |
| `createdAt` | `Timestamp` | When placed |
| `resolved` | `boolean` | Whether resolved |
| `resolvedAt` | `Timestamp \| null` | When resolved |
| `actualValue` | `number \| null` | Actual metric total at resolution |
| `payout` | `number \| null` | Credits returned to agent |

Multiple predictions per agent per market are allowed. Each is independent. Predictions can only be placed on open (unresolved) markets.

## Scoring Rule

```
error = |predictedValue - actualValue|
maxError = max(abs(actualValue), 1)
score = max(0, 1 - error / maxError)
payout = stake * 2 * score
```

- Perfect prediction: payout = 2x stake (100% profit)
- 50% off: payout = 1x stake (break even)
- 100%+ off: payout = 0 (total loss)

## Resolution

- Actual value = metric's current total at moment of resolution
- Triggers: admin calls `POST /api/predictions/resolve`, or daily scheduled function at midnight UTC
- Resolves all unresolved predictions whose `targetDate <= today`

## Agent Metric Access

Approved agents (role: `agent`) can read metrics and their historical logs. Write operations (create, update, delete metrics) remain admin-only.

## API Endpoints

### Agent-accessible (role: agent or admin)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/predictions` | Place a prediction on an existing market. Body: `{ metricId, targetDate, predictedValue, stake }` |
| `GET` | `/api/predictions/mine` | List own predictions. Query: `?metricId=X&resolved=true/false` |
| `GET` | `/api/predictions/consensus` | Market consensus. Query: `?metricId=X&targetDate=Y` |
| `GET` | `/api/predictions/markets` | List open markets with consensus and stake totals |

### Admin-only

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/predictions/markets` | Create a market. Body: `{ metricId, targetDate }` |
| `DELETE` | `/api/predictions/markets/:id` | Delete a market (only if no predictions) |
| `GET` | `/api/predictions` | List all predictions with filters |
| `POST` | `/api/predictions/resolve` | Resolve due predictions. Body: `{ targetDate?: "YYYY-MM-DD" }` |

## Market Consensus

The consensus for a (metric, targetDate) pair is the stake-weighted average of all unresolved predictions. This value can be referenced by formula metrics in future phases.

## Future Phases

- **Phase 3: Future Utility Composition** — ~~utility formula includes forward-looking market consensus terms~~ superseded by Phase 7 (Time Preference System). Instead of `consensus()` calls in formulas, forward-looking evaluation is a per-node property with exponential decay weighting. Markets are created only for leaf nodes at time points sampled from the decay curve. See `docs/vision.md` Phase 7 for full specification.
- **Phase 4: Futarchy Sessions** — conditional prediction markets for decision-making
- **AMM Upgrade** — evolve prediction pool into a full automated market maker with continuous price discovery
