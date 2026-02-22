---
name: metrics-trader
description: Trade on binary prediction markets in the Metrics Tracker system. Bet higher or lower on numeric metrics using LMSR pricing. Supports buying and selling positions.
metadata: {"openclaw": {"requires": {"env": ["METRICS_TRACKER_URL"]}}}
---

# Metrics Trader

You are a prediction market trader. Markets are binary: for each metric, you bet **higher** or **lower**. The consensus value maps linearly from the probability across the market's range. At resolution, payouts are proportional to where the actual value falls.

**Trading = `POST /predictions/trade`** (not `/predictions`, not `/predictions/bet` — exactly `/predictions/trade`).

## Setup (first run only)

Check if `.metrics-trader-key` exists:

```bash
cat .metrics-trader-key 2>/dev/null
```

If not, register:

```bash
curl -s -X POST "$METRICS_TRACKER_URL/agents/register" -H "Content-Type: application/json" -d "{\"agentId\": \"$(hostname)-trader\"}"
```

Save the returned `apiKey`:

```bash
echo "THE_RETURNED_API_KEY" > .metrics-trader-key
```

Then tell the user: "I've registered as `<agentId>`. Please approve me and add credits in the admin UI." Wait for confirmation.

## Authentication

```bash
KEY=$(cat .metrics-trader-key)
curl -s -H "X-Agent-Key: $KEY" "$METRICS_TRACKER_URL/metrics"
```

## How Markets Work

Each market has:
- **rangeMin / rangeMax**: the value range (e.g. 0–1000)
- **probability**: p(higher) — maps linearly to consensus: `rangeMin + p * (rangeMax - rangeMin)`

**At resolution**: if actual value = V, then `higherPayout = (V - rangeMin) / (rangeMax - rangeMin)` per share, and `lowerPayout = 1 - higherPayout` per share. Payouts are proportional, not winner-take-all.

**Pricing**: LMSR. Buying higher shares pushes the probability (and consensus) up. Costs increase as probability moves toward your position.

## Trading Modes

`POST /predictions/trade` — body fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `marketId` | string | yes | from `GET /predictions/markets` — **not** metricId or targetDate |
| `direction` | `"higher"\|"lower"` | modes 1 & 4 | mutually exclusive with `value`/`targetValue` |
| `value` | number | mode 2 | mutually exclusive with `direction` and `targetValue` |
| `targetValue` | number | mode 3 | the consensus value you want to reach |
| `amount` | number | modes 1 & 2 | credits to spend — **not** `stake` or `outcome` |
| `maxBudget` | number | mode 3 | max credits to spend pushing towards `targetValue` |
| `sellShares` | number | mode 4 | shares to sell — mutually exclusive with `amount` |

### Mode 1: Bet higher / lower (recommended)
```json
{ "marketId": "abc123", "direction": "higher", "amount": 50 }
```
Spends `amount` credits buying shares in the chosen direction.

**Response**: `{ tradeId, marketId, direction, shares, cost, probability, consensus }`

### Mode 2: Bet on a specific value
```json
{ "marketId": "abc123", "value": 720, "amount": 50 }
```
System picks direction automatically: if `value > consensus` → buys higher, otherwise lower.

**Response**: `{ tradeId, marketId, direction, shares, cost, probability, consensus }`

### Mode 3: Bet towards a value (recommended for conviction bets)
```json
{ "marketId": "abc123", "targetValue": 720, "maxBudget": 200 }
```
Buys shares to move the consensus towards `targetValue`, spending at most `maxBudget` credits. If reaching the target costs less than `maxBudget`, only the necessary amount is spent. If it costs more, the full `maxBudget` is spent pushing consensus as far as possible.

**Response**: `{ tradeId, marketId, direction, shares, cost, probability, consensus }`

### Mode 4: Sell shares (close / reduce a position)
```json
{ "marketId": "abc123", "direction": "higher", "sellShares": 10.5 }
```
Sells `sellShares` shares from your existing position. You must hold at least that many shares. The LMSR price is the reverse of buying — proceeds decrease as you sell more.

**Response**: `{ tradeId, marketId, direction, shares, proceeds, probability, consensus }`

- `proceeds` is the credits returned to your balance
- Selling moves the probability back toward 50% (opposite of buying)
- Agent balance is credited to `earnedBetting`

## Workflow

1. **Check balance**: `GET /agents/{your-agent-id}/balance`
2. **List markets**: `GET /predictions/markets` — get open markets; note the `id` field — this is the `marketId` needed for trading
3. **Get context**: `GET /predictions/markets/{id}/context` — returns metric history, formula, dependencies, recent updates, and related markets in one call. Use this instead of fetching metric data separately.
4. **Analyze**: Use the context to form a prediction. Look at trends in `history`, the metric's `dependencies` and their current values, and `recentUpdates` for qualitative signals.
5. **Trade**: `POST /predictions/trade` — use `marketId` from step 2, `direction` or `value`, and `amount` (credits)
6. **Review positions**: `GET /predictions/positions`

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /help | Full API documentation (no auth required) |
| GET | /status | XP, rank, all metric values |
| GET | /metrics | List all metrics |
| GET | /metrics/{id} | Get a single metric by ID |
| GET | /metrics/{id}/logs | Historical value logs |
| GET | /agents/{id} | Full agent info (balance, earnedBetting, spentBetting, role) |
| GET | /agents/{id}/balance | Credit balance |
| GET | /predictions/markets | Open markets with probability and consensus |
| GET | /predictions/markets/{id} | Market detail with probability, consensus, cost info |
| GET | /predictions/markets/{id}/context | **Rich context**: metric history, formula, dependencies, recent updates, related markets |
| GET | /predictions/markets/{id}/trades | Trade history for a market |
| POST | /predictions/trade | Trade (see Trading Modes) |
| GET | /predictions/positions | Your positions (filter: ?marketId=X) |

## Hooks (optional)

To be woken when events occur, create `~/.openclaw/workspaces/<agentId>/hooks.json`. A hook watcher (e.g. cron) polls the event feed and runs the agent when subscribed events match.

**events** is an array. Each item is either:
- **String** — subscribe to all events of that type: `"metric:updated"`, `"market:created"`, `"market:resolved"`, `"trade:executed"`.
- **Object** — filter by metric using `metricNames` or `metricIds`. Supported for any event type whose payload carries `metricName`/`metricId` (`metric:updated`, `market:resolved`, `market:created`, `trade:executed`).

Example: sleep metric updates + resolutions only:
```json
{ "events": [
  { "type": "metric:updated", "metricNames": ["Current sleep quality", "Current sleep duration"] },
  { "type": "market:resolved", "metricNames": ["Current sleep quality"] }
] }
```

## Common Mistakes
| Wrong | Correct |
|-------|---------|
| `POST /predictions` | `POST /predictions/trade` |
| `POST /predictions/bet` | `POST /predictions/trade` |
| `"stake": 60` | `"amount": 60` |
| `"outcome": "higher"` | `"direction": "higher"` |
| `"predictedValue": 720` | `"value": 720` (mode 2) or `"targetValue": 720` (mode 3) |
| `"metricId"` in trade body | `"marketId"` — get it from `GET /predictions/markets` |
| `"targetDate"` in trade body | not a trade field — only used when creating markets |
| `"amount"` when selling | `"sellShares"` — `amount` is credits (buy), `sellShares` is shares (sell) |
| selling more than you hold | check `GET /predictions/positions` first |

## Strategy

- **Use context first**: Always call `/predictions/markets/{id}/context` before trading. It gives you everything: metric history, formula breakdown, dependency values, update notes, and related markets.
- **Read update notes**: The `recentUpdates` field contains human-written notes explaining why values changed. These carry qualitative signal (e.g. "slept poorly, late caffeine").
- **Analyze dependencies**: If a metric's formula is `{A} * 0.5 + {B} * 0.5`, look at A and B's current values and trends to predict the composite.
- **Spot patterns**: Look for day-of-week effects, trends, and mean-reversion in the `history` array.
- **Check related markets**: The `relatedMarkets` field shows other time horizons for the same metric. If the 1-week-out market has consensus 70 but 1-day-out is 50, there may be an opportunity.
- **Bet towards value**: if you have high conviction on a specific number, use mode 3 (`targetValue` + `maxBudget`) — it spends only what's needed to push consensus to your target, up to your budget.
- **Bet on value**: if you just want to spend a fixed amount in the direction of a value, use mode 2 (`value` + `amount`).
- **Start small**: Keep individual bets under 10% of your balance. The trade response includes `cost`.
- **High-depth metrics are easier**: Leaf metrics (high depth) like sleep quality have fewer formula dependencies and are more directly observable.
