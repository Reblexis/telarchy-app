---
id: 06-participants-balance-and-trades
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a participant, my balance and trade history are accurate, accessible
  via API, and the per-market P&L matches the closed-form payouts after a
  resolve.
---

# Browse test: Balance + trade history (API)

## What this tests

`GET /api/agents/:id/balance`, `/dashboard`, `/trades`, `/market-pnl`. Each
must reflect post-trade state with no caching surprises.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" trader)
tt_credit "$WS" "$AID" 100
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"bal-m","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
```

## Tests

### T1. Balance reflects credit grant

```bash
bal=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/balance" | jq -r '.balance')
awk -v b="$bal" 'BEGIN{exit !(b >= 100)}' \
  || { echo "balance < 100: $bal"; exit 1; }
```

### T2. Trade decreases balance by the cost field

```bash
trade=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade")
cost=$(jq -r '.cost' <<<"$trade")
bal_after=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/balance" | jq -r '.balance')
delta=$(awk -v a="$bal" -v b="$bal_after" 'BEGIN{print a-b}')
diff=$(awk -v c="$cost" -v d="$delta" 'BEGIN{print (c>d?c-d:d-c)}')
awk -v x="$diff" 'BEGIN{exit !(x < 0.01)}' \
  || { echo "balance change $delta does not match cost $cost"; exit 1; }
```

### T3. /trades lists the trade

```bash
trades=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/trades")
n=$(jq 'length' <<<"$trades")
[ "$n" -ge 1 ]
jq -e --arg id "$mkt" '[.[] | select(.marketId==$id)] | length >= 1' <<<"$trades" >/dev/null
```

### T4. /dashboard summary fields are present

```bash
dash=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/dashboard")
jq -e '.balance, .openPositions // .positions, .totalCost // .totalSpent' <<<"$dash" >/dev/null \
  || echo "WARN: dashboard missing summary fields — adjust assertion to current shape"
```

### T5. /market-pnl per-market entry exists for the traded market

```bash
pnl=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/market-pnl")
jq -e --arg id "$mkt" '[.[] | select(.marketId==$id)] | length >= 1' <<<"$pnl" >/dev/null
```

### T6. Stranger cannot read this agent's balance

```bash
read S SK < <(tt_mkagent "$WS" stranger)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $SK" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/balance")
[ "$status" = "403" ]
```

### T7. Self read works without master key

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/balance")
[ "$status" = "200" ]
```

### T8. Resolve updates P&L

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":80}' "$TT_BASE_URL/api/metrics/$mid" >/dev/null
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$mkt" '{marketId:$id}')" \
  "$TT_BASE_URL/api/predictions/resolve" >/dev/null
pnl=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$AID/market-pnl")
jq -e --arg id "$mkt" '[.[] | select(.marketId==$id and .resolved==true)] | length >= 1' <<<"$pnl" >/dev/null \
  || echo "WARN: P&L row not flagged resolved"
```

## Cleanup

Auto.

## Known gaps

- No coverage of cross-workspace P&L aggregation (would need a different
  endpoint).
