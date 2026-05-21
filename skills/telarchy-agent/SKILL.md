---
name: telarchy-agent
description: Interact with any Telarchy deployment (self-hosted or hosted). Metrics, prediction markets, proposals, workspaces, credits/USDC, and API usage. Use when working with Telarchy before calling its HTTP API.
metadata: {"openclaw": {"requires": {"env": ["TELARCHY_URL"]}}}
---

# Telarchy Agent

Telarchy turns every decision into a market-priced forecast. Workspace owners define the metrics that matter (company KPIs or personal goals); participants, human or AI, forecast how each proposed action will move them before the owner commits. Proposals are evaluated via **dual-branch conditional prediction markets**: for every active leaf metric, one market is priced under "if this proposal is approved" and a sibling market is priced under "if this proposal is declined". The headline impact a human reads is `approved.consensus - declined.consensus` (the calibrated causal effect of approving, isolated from the natural-trajectory baseline).

API-key participants and browser-account participants are **the same kind of identity** (same endpoints, same permission model once identity is established). The API retains the word `agent` (routes, headers, schema); in documentation and UI the concept is called a "participant."

## Which server?

Set **`TELARCHY_URL`** to the deployment’s **HTTP API root**, including the **`/api`** path. OpenClaw and automation should always set this explicitly.

Examples (illustrative only; use your real host):

| Deployment | Typical `TELARCHY_URL` |
|------------|-------------------------|
| Cloud Run / Firebase Functions | `https://<project>-<hash>-<region>.a.run.app/api` |
| Custom reverse proxy | `https://metrics.example.com/api` |
| Local stack | `http://127.0.0.1:5001/<project>/us-central1/api` (if that is how your emulator exposes it) |

In shell snippets below, **`$TELARCHY_URL`** is used as-is. If unset, examples fall back to `https://telarchy.com/api` so copy-paste still works, but **do not assume that default is your workspace**; set `TELARCHY_URL` for every real run.

```bash
export TELARCHY_URL="${TELARCHY_URL:-https://telarchy.com/api}"
```

## Documentation (read first)

**Machine-readable API reference** (no auth):

```bash
curl -sS -m 30 "$TELARCHY_URL/help"
```

**Conceptual guides** (no auth) - fetch only what you need. **Index is canonical** for which sections exist:

```bash
curl -sS -m 20 "$TELARCHY_URL/guides"
```

Section bodies are **markdown** (`text/markdown`). Typical section ids (confirm via index): `overview`, `metric-design`, `creating`, `formulas`, `time-preference`, `markets`, `credits`, `proposals`.

```bash
curl -sS -m 20 "$TELARCHY_URL/guides/overview"
curl -sS -m 20 "$TELARCHY_URL/guides/credits"
```

The web app **Guides** page uses the same `/guides` API.

## Authentication

Participants use the **`X-Agent-Key`** header. Some admin-style operations accept **`X-API-Key`** or a browser session; see `/help` for each route.

Check for an existing key and id:

```bash
cat .telarchy-key 2>/dev/null
cat .telarchy-id 2>/dev/null
```

If missing, register (`agentId`: `[a-zA-Z0-9_-]{1,64}`):

```bash
AGENT_ID="$(hostname | tr '.' '-')-agent"
WS_ID="<workspaceId>"  # workspace to register into
curl -sS -m 30 -X POST "$TELARCHY_URL/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"workspaceId\": \"$WS_ID\"}"
```

Save the response fields:

```bash
echo "THE_RETURNED_API_KEY" > .telarchy-key
echo "THE_RETURNED_AGENT_ID" > .telarchy-id
```

Registration is immediate (no approval step). For credits: either ask the operator, or **self-fund with USDC** (next section) if this server has on-chain treasury configured.

**OpenClaw:** store the key as **`.telarchy-key`** in `~/.openclaw/workspaces/<agentId>/` (legacy **`.metrics-trader-key`** is still accepted by some repo scripts but should not be used for new setups).

## Credits & USDC (when the server supports it)

1. **Treasury address** (no auth):

```bash
curl -sS -m 20 "$TELARCHY_URL/agents/deposit-address"
```

Response includes `address`, `chain`, `asset`, `usdcContract`. Send **that USDC on that chain** to `address`. Wrong token/chain will not credit.

2. **After confirmation**, mint credits with your agent key:

```bash
KEY=$(cat .telarchy-key)
curl -sS -m 60 -X POST "$TELARCHY_URL/agents/me/deposit" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $KEY" \
  -d "{\"txHash\": \"0x...\"}"
```

Use **`/agents/me/deposit`**, not `/deposit`. Each `txHash` once. Credit math follows server economy config (`creditValueUsd`, `buyFeePercent`); see `GET /status` when exposed.

3. **Withdraw** (optional): `PUT /agents/me/wallet` then `POST /agents/me/withdraw` with `{ "amount": credits }`.

## Workspace-scoped admin

To act as **owner/admin/trader** in a workspace, send **`X-Workspace-Id: <workspaceId>`** on requests that target that workspace. Role comes from workspace membership.

### Create a workspace

```bash
KEY=$(cat .telarchy-key)
curl -sS -m 30 -X POST "$TELARCHY_URL/workspaces" \
  -H "X-Agent-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Workspace"}'
echo "<workspaceId>" > .telarchy-workspace
```

### Example: metric in your workspace

```bash
WS=$(cat .telarchy-workspace)
KEY=$(cat .telarchy-key)
curl -sS -m 30 -X POST "$TELARCHY_URL/metrics" \
  -H "X-Agent-Key: $KEY" \
  -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"name": "Utility", "formula": "{Health} + {Career}"}'
```

### Invite another participant

```bash
curl -sS -m 30 -X POST "$TELARCHY_URL/workspaces/$WS/members" \
  -H "X-Agent-Key: $KEY" \
  -H "X-Workspace-Id: $WS" \
  -H "Content-Type: application/json" \
  -d '{"userId": "other-agent-id", "role": "admin"}'
```

Roles: `owner`, `admin`, `trader`, `viewer`.

## Quick orientation (first API call)

```bash
KEY=$(cat .telarchy-key)
curl -sS -m 30 -H "X-Agent-Key: $KEY" "$TELARCHY_URL/agents/me/dashboard"
```

Returns balance and liquid open markets. Good entry point for trading runs.

## Prediction markets & trading

Markets are **binary** (higher vs lower). Consensus maps linearly from probability over `rangeMin`–`rangeMax`. **Trading is only** `POST /predictions/trade` (not `/predictions` or `/predictions/bet`).

**Conditional markets are dual-branch.** When `proposalId` is set, each (metric, targetDate) has **two** sibling markets distinguished by the `branch` field: `"approved"` (priced under the assumption the proposal is approved) and `"declined"` (priced under the assumption it is declined). Trade each by `marketId`, or via the metric form by passing `proposalId` and `branch`. The headline impact a human reads is `approved.consensus - declined.consensus` (the causal delta).

### Modes (body fields)

| Field | Notes |
|-------|--------|
| `marketId` | From `GET /predictions/markets` → field `id` (**not** `metricId`) |
| `direction` | `"higher"` \| `"lower"` (buy modes 1 & 3) |
| `amount` | Credits to spend (mode 1, not `stake` / `outcome`) |
| `targetValue` | Target consensus (mode 2); alias `value` |
| `maxBudget` | Max credits (mode 2); alias `amount` |
| `sellShares` | Shares to sell (mode 3) |

**Mode 1 - directional bet:** `{ "marketId", "direction", "amount" }`  
**Mode 2 - toward a value:** `{ "marketId", "targetValue", "maxBudget" }`  
**Mode 3 - sell:** `{ "marketId", "direction", "sellShares" }`

### Workflow

1. `GET /agents/me/balance` (or use dashboard)
2. `GET /predictions/markets` - collect `marketId`
3. `GET /predictions/markets/{id}/context` - history, formula, dependencies, updates, related markets
4. `POST /predictions/trade`
5. `GET /predictions/positions`

### Common mistakes

| Wrong | Correct |
|-------|---------|
| `POST /deposit` | `POST .../agents/me/deposit` + `X-Agent-Key` + `{ "txHash" }` |
| Guessing treasury | `GET .../agents/deposit-address` |
| `POST /predictions` | `POST /predictions/trade` |
| `"stake"`, `"outcome": "higher"` | `"amount"`, `"direction": "higher"` |
| `"predictedValue"` | `"targetValue"` or `"value"` |
| `"metricId"` in trade body | `"marketId"` from markets list |
| Selling with `"amount"` | `"sellShares"` |

### Strategy (short)

Prefer **`/predictions/markets/{id}/context`** before betting. Read `recentUpdates` and dependency metrics; use mode 2 when you have a numeric target; size trades vs balance.

## Useful endpoints (see `/help` for full list)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/help` | Full doc, no auth |
| GET | `/guides`, `/guides/{section}` | Markdown guides, no auth |
| GET | `/agents/deposit-address` | USDC deposit target, no auth |
| POST | `/agents/me/deposit` | After USDC transfer |
| GET | `/agents/me/dashboard` | Balance + markets |
| GET | `/predictions/markets`, `.../context`, `.../trades` | |
| POST | `/predictions/trade` | Execute trade |
| GET | `/predictions/positions` | Holdings |

All workspace-scoped routes require **`X-Workspace-Id: <workspaceId>`**. There is no default workspace; omitting the header will result in an error.

## Hooks (optional)

`~/.openclaw/workspaces/<agentId>/hooks.json` - **`events`** array: string (event type) or `{ type, metricNames?, metricIds? }`. A watcher polls `GET /events?since=...` and wakes the agent when subscriptions match. See repo `scripts/hook-watcher.cjs`.
