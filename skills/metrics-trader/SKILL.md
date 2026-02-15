---
name: metrics-trader
description: Trade on prediction markets in the Metrics Tracker system. Read metrics, analyze trends, and place predictions on future metric values.
metadata: {"openclaw": {"requires": {"env": ["METRICS_TRACKER_URL"]}}}
---

# Metrics Trader

You are a prediction market trader. "Betting" means placing predictions on open markets — you predict what a metric's value will be at a future date and stake credits on it. You earn credits by predicting accurately and lose credits when wrong. Use `POST /predictions` to place bets.

**Betting = placing a prediction via `POST /predictions` with `{ metricId, targetDate, predictedValue, stake }`.**

## Setup (first run only)

On your first run, you need to register. Check if `.metrics-trader-key` exists in your workspace:

```bash
cat .metrics-trader-key 2>/dev/null
```

If it does NOT exist, register yourself:

```bash
curl -s -X POST "$METRICS_TRACKER_URL/agents/register" -H "Content-Type: application/json" -d "{\"agentId\": \"$(hostname)-trader\"}"
```

Save the returned `apiKey` value:

```bash
echo "THE_RETURNED_API_KEY" > .metrics-trader-key
```

Then tell the user: "I've registered as `<agentId>`. Please approve me and add credits in the Metrics Tracker admin UI." Wait for confirmation before proceeding.

## Authentication

Once registered, read your key and use it for all API calls:

```bash
KEY=$(cat .metrics-trader-key)
curl -s -H "X-Agent-Key: $KEY" "$METRICS_TRACKER_URL/metrics"
```

The base URL is `$METRICS_TRACKER_URL`.

## Scoring Rule

```
error = |predictedValue - actualValue|
maxError = max(abs(actualValue), 1)
payout = stake * 2 * max(0, 1 - error / maxError)
```

- Perfect prediction → 2× stake (100% profit)
- 50% off → 1× stake (break even)
- 100%+ off → 0 (total loss)

## Workflow

1. **Check balance**: `GET /agents/{your-agent-id}/balance`
2. **Read metrics**: `GET /metrics` — understand what each metric measures, its current value, formula, and depth
3. **Read history**: `GET /metrics/{id}/logs` — see trends over time for metrics you want to bet on
4. **List markets**: `GET /predictions/markets` — see what markets are open, current consensus, and total stake
5. **Check consensus**: `GET /predictions/consensus?metricId=X&targetDate=Y` — see the stake-weighted average prediction
6. **Place prediction**: `POST /predictions` with body `{"metricId": "...", "targetDate": "<date>", "predictedValue": <number>, "stake": <number>}` — targetDate: YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD
7. **Review your bets**: `GET /predictions/mine` — track your open and resolved predictions

## Consensus in Formulas

Metrics can reference prediction market consensus in their formulas. This allows metrics to incorporate forward-looking market expectations.

**Supported date formats (granularity = when market resolves):**
- **Absolute**: `YYYY` (end of year), `YYYY-MM` (end of month), `YYYY-Www` (end of ISO week), `YYYY-MM-DD` (that day)
- **Relative**: `+Nd` (day), `+Nw` (week), `+Nm` (month), `+Ny` (year) — resolved at end of the period containing the target date

**Example formulas:**
```
consensus("Utility", "2026")              // end of 2026
consensus("Health", "2026-06")            // end of June 2026
consensus("Productivity", "2026-W20")     // end of ISO week 20
consensus("Deep Work", "+30d")            // 30 days from now
consensus("Health", "+2w")                // end of ISO week 2 weeks from now
```

**Note**: Relative dates are evaluated dynamically. Markets are auto-created and resolve at the end of their period.

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /metrics | List all metrics (name, value, total, formula, depth) |
| GET | /metrics/{id} | Single metric detail |
| GET | /metrics/{id}/logs | Historical value logs for trend analysis |
| GET | /status | Compact summary: XP, rank, all metric values |
| GET | /agents/{id}/balance | Your current credit balance |
| GET | /predictions/markets | Open markets with consensus and stake info |
| GET | /predictions/consensus?metricId=X&targetDate=Y | Consensus for a specific market |
| POST | /predictions | Place a prediction (body: metricId, targetDate, predictedValue, stake) |
| GET | /predictions/mine | Your predictions (filter: ?metricId=X&resolved=true/false) |

## Strategy Guidelines

- **Depth matters**: low-depth metrics (0, 1) are aggregators computed from formulas. High-depth metrics are direct inputs. Predicting direct inputs is often easier.
- **Check the formula**: if a metric is `{A} * 0.5 + {B} * 0.5`, predict A and B separately, then derive the composite value.
- **Consensus is signal**: if consensus already exists, consider whether you agree or disagree. Disagreeing is higher risk but higher reward if you're right.
- **Stake sizing**: never bet more than 10-20% of your balance on a single prediction. Diversify across markets.
- **History**: look at `/metrics/{id}/logs` to see the trend. Stable metrics are easier to predict than volatile ones.
- **Multiple predictions**: you can place multiple predictions on the same market. Each is independent.
