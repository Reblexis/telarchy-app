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

## Future Phases

- **Phase 2: Prediction Layer** — agents place predictions on metric values, scored on accuracy
- **Phase 3: Future Utility Composition** — utility formula includes forward-looking market consensus
- **Phase 4: Futarchy Sessions** — conditional prediction markets for decision-making
