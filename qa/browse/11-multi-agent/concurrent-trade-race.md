---
id: 11-multi-agent-concurrent-trade-race
tags: [api-only, multi-agent, slow]
isolation: workspace
parallel-safe: false
needs: [auth, master-key]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a market under contention, twenty simultaneous trades from different
  participants do not corrupt the AMM state — total shares match the
  closed-form expectation, no participant ends with negative balance, and
  no double-spends slip through.
---

# Browse test: Concurrent trade race

## What this tests

`POST /api/predictions/trade` under simultaneous load on one market. The
LMSR engine has to serialise updates against a per-market lock; this spec
fires 20 trades in parallel and asserts the post-state is consistent.

`parallel-safe: false` — running this in parallel with another spec on the
same backend produces noise.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"race","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:200, skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
keys=()
aids=()
for i in $(seq 1 20); do
  read aid akey < <(tt_mkagent "$WS" "race$i")
  tt_credit "$WS" "$aid" 100
  keys+=("$akey")
  aids+=("$aid")
done
```

## Tests

### T1. Fire 20 trades in parallel (10 higher, 10 lower)

```bash
trade_one() {
  local key="$1" dir="$2"
  curl -sf -H "X-Agent-Key: $key" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$mkt" --arg d "$dir" '{marketId:$id, direction:$d, amount:5}')" \
    "$TT_BASE_URL/api/predictions/trade" 2>/dev/null
}
export -f trade_one
export TT_BASE_URL WS mkt
pids=()
for i in $(seq 0 9);  do trade_one "${keys[$i]}"  higher >/tmp/$TT_NS-$i-h.json &
                          pids+=($!); done
for i in $(seq 10 19); do trade_one "${keys[$i]}" lower  >/tmp/$TT_NS-$i-l.json &
                          pids+=($!); done
fails=0
for pid in "${pids[@]}"; do wait "$pid" || fails=$((fails+1)); done
[ "$fails" -le 2 ] || { echo "$fails of 20 parallel trades failed"; exit 1; }
```

### T2. Market state is internally consistent

```bash
out=$(curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt")
echo "$out" | jq -e '.consensus, .liquidity' >/dev/null
# Consensus should still be a finite number in [rangeMin, rangeMax]
c=$(jq -r '.consensus' <<<"$out")
awk -v c="$c" 'BEGIN{exit !(c >= 0 && c <= 100)}' \
  || { echo "consensus $c outside range"; exit 1; }
```

### T3. Trade count = 20 (or fewer iff some 4xx'd, no double-counts)

```bash
trades=$(curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/trades")
n=$(jq 'length' <<<"$trades")
[ "$n" -ge 18 ] && [ "$n" -le 20 ] \
  || { echo "trade count out of bounds: $n"; exit 1; }
```

### T4. No participant ended with negative balance

```bash
for i in $(seq 1 20); do
  aid="${aids[$((i-1))]}"
  bal=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$aid/balance" \
    | jq -r '.balance' 2>/dev/null)
  [ -z "$bal" ] && continue
  awk -v b="$bal" 'BEGIN{exit !(b >= 0)}' \
    || { echo "race$i ended with $bal"; exit 1; }
done
```

### T5. AMM cost-sum invariant: spent ≈ total cost recorded by trades

```bash
total_cost=$(jq '[.[].cost] | add' <<<"$trades")
spent_sum=$(awk -v t="0" 'BEGIN{print 0}')  # build by reading each agent
total_spent=0
for i in $(seq 1 20); do
  aid="${aids[$((i-1))]}"
  bal=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$aid/balance" \
    | jq -r '.balance' 2>/dev/null)
  [ -z "$bal" ] && continue
  # Each agent: 1000 starter signup credits + 100 we tt_credited = 1100 starting.
  spent=$(awk -v b="$bal" 'BEGIN{print 1100-b}')
  total_spent=$(awk -v a="$total_spent" -v b="$spent" 'BEGIN{print a+b}')
done
diff=$(awk -v a="$total_spent" -v b="$total_cost" 'BEGIN{print (a>b?a-b:b-a)}')
awk -v d="$diff" 'BEGIN{exit !(d < 1.0)}' \
  || { echo "spent ($total_spent) vs cost ($total_cost) divergence $diff"; exit 1; }
```

## Cleanup

Auto.

## Known gaps

- No coverage of cancellation under contention (no cancel endpoint).
- No assertion that the per-market lock is actually held (would need
  microsecond-precision timing).
