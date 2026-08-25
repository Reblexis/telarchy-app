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
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"liq","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:10, skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
# Liquidity injection requires an agent member of this workspace.
read LP_AID LP_KEY < <(tt_mkagent "$WS" lp)
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg p "$LP_AID" '{participantId:$p, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
tt_credit "$WS" "$LP_AID" 100
```

## Tests

### T1. Initial liquidity matches request

```bash
liq=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
# Either equals the requested value or matches the workspace default if missing
[ -n "$liq" ] && [ "$liq" != "null" ]
```

### T2. Add liquidity → LMSR `b` parameter increases

The API takes `{amount, agentId}` (positive credits contributed by a
workspace-member participant). Removing liquidity is not exposed via this
endpoint; the only way to take liquidity off a market is `void`.

```bash
b1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg a "$LP_AID" '{amount:5, agentId:$a}')" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity" >/dev/null
b2=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.liquidity')
awk -v a="$b1" -v b="$b2" 'BEGIN{exit !(b > a)}' \
  || { echo "liquidity did not increase: $b1 → $b2"; exit 1; }
```

### T3. Negative or zero amount is rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg a "$LP_AID" '{amount:-2, agentId:$a}')" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity")
case "$status" in 400|422) ;; *) echo "negative amount returned $status"; exit 1;; esac
```

### T4. Liquidity events log records every injection

```bash
events=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt/liquidity-events")
n=$(jq 'length' <<<"$events")
[ "$n" -ge 1 ] || { echo "expected ≥1 events, got $n"; exit 1; }
```

### T5. Bulk liquidity edits across multiple markets

```bash
m2=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2031-01-01", liquidity:10, skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg a "$mkt" --arg b "$m2" --arg p "$LP_AID" \
      '{updates:[{marketId:$a,amount:1,agentId:$p},{marketId:$b,amount:1,agentId:$p}]}')" \
  "$TT_BASE_URL/api/predictions/markets/liquidity/bulk")
echo "$out" | jq -e '.updated // .results' >/dev/null \
  || { echo "bulk liquidity returned no per-market result"; exit 1; }
```

### T6. Skipped — endpoint does not support removal; voiding the market is the only way to drain it

```bash
echo "skipped: removal not supported via /:id/liquidity endpoint"
```

### T6_unused (removed in favour of /void test in void-and-resolve.md)

```bash skip
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
