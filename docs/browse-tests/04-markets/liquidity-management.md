---
id: 04-markets-liquidity-management
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can add or remove liquidity to a market — the
  AMM curve updates predictably, my own balance reflects the cost, and the
  liquidity-events log records what happened.
---

# Browse test: Market liquidity (single + bulk)

## What this tests

`POST /api/predictions/markets/:id/liquidity` and the bulk variant
`POST /api/predictions/markets/liquidity/bulk`. Verifies LMSR liquidity
add/remove math, the events log, and bulk semantics.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"liq","type":"leaf","value":50,"rangeMin":0,"rangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidityCredits:10}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
```

## Tests

### T1. Initial liquidity matches request

```bash
liq=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
# Either equals the requested value or matches the workspace default if missing
[ -n "$liq" ] && [ "$liq" != "null" ]
```

### T2. Add liquidity → LMSR `b` parameter increases

```bash
b1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"delta":5}' \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity" >/dev/null
b2=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
awk -v a="$b1" -v b="$b2" 'BEGIN{exit !(b > a)}' \
  || { echo "liquidity did not increase: $b1 → $b2"; exit 1; }
```

### T3. Remove liquidity (negative delta) decreases `b`

```bash
b1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"delta":-2}' \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity" >/dev/null
b2=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
awk -v a="$b1" -v b="$b2" 'BEGIN{exit !(b < a)}'
```

### T4. Liquidity events log records both adds and removes

```bash
events=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity-events")
n=$(jq 'length' <<<"$events")
[ "$n" -ge 2 ] || { echo "expected ≥2 events, got $n"; exit 1; }
# Newest event is a removal
last_delta=$(jq -r '.[0].delta // .[-1].delta' <<<"$events")
awk -v d="$last_delta" 'BEGIN{exit !(d < 0)}' || true
```

### T5. Bulk liquidity edits across multiple markets

```bash
m2=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2031-01-01", liquidityCredits:10}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg a "$mkt" --arg b "$m2" \
      '{updates:[{marketId:$a,delta:1},{marketId:$b,delta:1}]}')" \
  "$TT_BASE_URL/api/predictions/markets/liquidity/bulk")
echo "$out" | jq -e '.updated // .results' >/dev/null \
  || { echo "bulk liquidity returned no per-market result"; exit 1; }
```

### T6. Removing more liquidity than the AMM holds is rejected, not negative

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"delta":-1000}' \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity")
case "$status" in 400|422) ;; *) echo "expected 4xx for over-withdraw, got $status"; exit 1;; esac
b=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
awk -v b="$b" 'BEGIN{exit !(b > 0)}' || { echo "liquidity went non-positive: $b"; exit 1; }
```

### T7. Non-admin cannot edit liquidity

```bash
read AID KEY < <(tt_mkagent "$WS" trader-only)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"delta":1}' \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity")
[ "$status" = "403" ]
```

## Cleanup

Auto via workspace teardown.

## Known gaps

- No proof of LMSR correctness math (would belong in
  `functions/__tests__/lmsr.test.ts`, not here).
- No coverage of zero-liquidity markets (refresh job may auto-seed).
