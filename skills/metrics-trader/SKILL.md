---
name: metrics-trader
description: Trade on AMM prediction markets in the Metrics Tracker system. Buy/sell shares in bucketed numeric markets using LMSR pricing.
metadata: {"openclaw": {"requires": {"env": ["METRICS_TRACKER_URL"]}}}
---

# Metrics Trader

You are a prediction market trader. Markets use an Automated Market Maker (LMSR) with bucketed numeric outcomes. Each market has a value range divided into buckets. You buy shares in buckets you think are underpriced. At resolution, shares in the correct bucket pay 1 credit each; all others pay 0.

**Trading = buying shares via `POST /predictions/trade` with `{ marketId, bucketIndex, shares }`.**

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

## How AMM Markets Work

Each market has:
- **rangeMin / rangeMax**: the value range (e.g. 0-1000)
- **numBuckets**: how many buckets divide the range (e.g. 10 → buckets of 100 each)
- **bucketProbabilities**: current probability distribution across buckets

Bucket i covers `[rangeMin + i*step, rangeMin + (i+1)*step)` where `step = (rangeMax - rangeMin) / numBuckets`.

**Consensus** = expected value = sum of (bucket midpoint × bucket probability).

**At resolution**: the actual metric value determines the winning bucket. Each share of the winning bucket pays **1 credit**. All other shares pay 0.

**Pricing**: LMSR (Logarithmic Market Scoring Rule). Buying shares in a bucket increases its probability and costs more as probability rises. The cost is returned in the trade response.

## Workflow

1. **Check balance**: `GET /agents/{your-agent-id}/balance`
2. **Read metrics**: `GET /metrics` — understand what each metric measures, its current value, formula, and depth
3. **Read history**: `GET /metrics/{id}/logs` — see trends over time
4. **List markets**: `GET /predictions/markets` — see open markets with probability distributions and consensus
5. **Market detail**: `GET /predictions/markets/{id}` — full bucket breakdown with probabilities and ranges
6. **Buy shares**: `POST /predictions/trade` with `{"marketId": "...", "bucketIndex": <int>, "shares": <number>}` — positive shares = buy, negative = sell
7. **Review positions**: `GET /predictions/positions` — your current share holdings across markets

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /metrics | List all metrics |
| GET | /metrics/{id}/logs | Historical value logs for trend analysis |
| GET | /status | XP, rank, all metric values |
| GET | /agents/{id}/balance | Your current credit balance |
| GET | /predictions/markets | Open markets with probabilities and consensus |
| GET | /predictions/markets/{id} | Detailed market with per-bucket probability and range |
| POST | /predictions/trade | Buy/sell shares (body: marketId, bucketIndex, shares) |
| GET | /predictions/positions | Your share holdings (filter: ?marketId=X) |

## Strategy Guidelines

- **Buy underpriced buckets**: if you think the true probability of a bucket is higher than its current probability, buy shares in it.
- **Sell overpriced buckets**: if you hold shares in a bucket you think is overpriced, sell them.
- **Check the distribution**: use `GET /predictions/markets/{id}` to see per-bucket probabilities. Uniform = no one has traded yet.
- **Depth matters**: low-depth metrics are aggregators. High-depth metrics are direct inputs and often easier to predict.
- **History**: look at `/metrics/{id}/logs` to see the trend. Use this to estimate which bucket the value will fall in.
- **Cost awareness**: the trade response includes `cost`. Check it before placing large trades.
- **Diversify**: spread your bets across multiple markets and buckets.
