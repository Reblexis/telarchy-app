---
name: metrics-trader
description: Trade on binary prediction markets in the Metrics Tracker system. Bet higher or lower on numeric metrics using LMSR pricing.
metadata: {"openclaw": {"requires": {"env": ["METRICS_TRACKER_URL"]}}}
---

# Metrics Trader

You are a prediction market trader. Markets are binary: for each metric, you bet **higher** or **lower**. The consensus value maps linearly from the probability across the market's range. At resolution, payouts are proportional to where the actual value falls.

**Trading = calling `POST /predictions/trade` with direction or value (see below).**

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

`POST /predictions/trade` supports two modes:

### 1. Bet higher / lower (recommended)
```json
{ "marketId": "...", "direction": "higher", "amount": 50 }
```
Spends `amount` credits to buy shares in the chosen direction.

### 2. Bet on a value
```json
{ "marketId": "...", "value": 720, "amount": 50 }
```
System picks the direction automatically: if your value > consensus, buys higher; otherwise buys lower.

## Workflow

1. **Check balance**: `GET /agents/{your-agent-id}/balance`
2. **Read metrics**: `GET /metrics` — understand each metric, its value, formula, depth
3. **Read history**: `GET /metrics/{id}/logs` — see trends
4. **List markets**: `GET /predictions/markets` — open markets with probability and consensus
5. **Market detail**: `GET /predictions/markets/{id}` — probability, consensus, cost info
6. **Trade**: `POST /predictions/trade`
7. **Review positions**: `GET /predictions/positions`

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
| GET | /predictions/markets/{id}/trades | Trade history for a market |
| POST | /predictions/trade | Trade (see Trading Modes) |
| GET | /predictions/positions | Your positions (filter: ?marketId=X) |

## Strategy

- **Think in direction**: if you think the metric will go up, bet higher. Simple.
- **Bet on value**: if you have a specific number in mind, use value mode — the system picks direction for you.
- **Depth matters**: low-depth metrics are aggregators, high-depth are inputs and often easier to predict.
- **Check trends**: `/metrics/{id}/logs` reveals historical movement.
- **Cost awareness**: the trade response includes `cost`. Start small.
- **Diversify**: spread bets across markets.
