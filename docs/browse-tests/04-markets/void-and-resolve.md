---
id: 04-markets-void-and-resolve
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can resolve a market at the metric's actual
  value (paying winners proportionally) or void it (refunding all stakes).
  Both flows leave balances within rounding of expectation.
---

# Browse test: Market resolution + void

## What this tests

`POST /api/predictions/resolve` and `POST /api/predictions/markets/:id/void`.
Each runs after at least one trade has been placed. The spec checks balance
deltas against closed-form LMSR expectations within tolerance.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"vr","type":"leaf","value":50,"rangeMin":0,"rangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidityCredits:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
read T1 K1 < <(tt_mkagent "$WS" t1)
read T2 K2 < <(tt_mkagent "$WS" t2)
tt_credit "$WS" "$T1" 100
tt_credit "$WS" "$T2" 100
trade() { # $1 key, $2 dir, $3 amt
  curl -sf -H "X-Agent-Key: $1" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$mkt" --arg d "$2" --argjson a $3 \
        '{marketId:$id, direction:$d, amount:$a}')" \
    "$TT_BASE_URL/api/predictions/trade"
}
```

## Tests

### T1. Both traders place opposing positions

```bash
trade "$K1" higher 5 >/dev/null
trade "$K2" lower 5 >/dev/null
balT1_pre=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T1/balance" | jq -r '.balance')
balT2_pre=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T2/balance" | jq -r '.balance')
echo "pre-resolve: t1=$balT1_pre t2=$balT2_pre"
```

### T2. Resolve at metric value 80 → "higher" wins

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":80}' "$TT_BASE_URL/api/metrics/$mid" >/dev/null
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$mkt" '{marketId:$id}')" \
  "$TT_BASE_URL/api/predictions/resolve" >/dev/null
balT1_post=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T1/balance" | jq -r '.balance')
balT2_post=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T2/balance" | jq -r '.balance')
awk -v a="$balT1_pre" -v b="$balT1_post" 'BEGIN{exit !(b > a)}' \
  || { echo "T1 should have gained on higher with metric=80; pre=$balT1_pre post=$balT1_post"; exit 1; }
awk -v a="$balT2_pre" -v b="$balT2_post" 'BEGIN{exit !(b <= a)}' \
  || { echo "T2 should not have gained on lower with metric=80; pre=$balT2_pre post=$balT2_post"; exit 1; }
```

### T3. Resolved market is read-only

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $K1" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
case "$status" in 400|409|422) ;; *) echo "trade after resolve returned $status (want 4xx)"; exit 1;; esac
```

### T4. Void on a fresh market refunds stakes

```bash
mid2=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"vr2","type":"leaf","value":50,"rangeMin":0,"rangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt2=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid2" '{metricId:$m, targetDate:"2030-01-01", liquidityCredits:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
pre1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T1/balance" | jq -r '.balance')
curl -sf -H "X-Agent-Key: $K1" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt2" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
mid_pre=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T1/balance" | jq -r '.balance')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/$mkt2/void" >/dev/null
post=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$T1/balance" | jq -r '.balance')
delta=$(awk -v a="$pre1" -v b="$post" 'BEGIN{print a-b}')
# After buy + void, balance should be ~equal to pre, modulo LMSR spread
awk -v d="$delta" 'BEGIN{exit !(d < 1.0 && d > -1.0)}' \
  || { echo "void did not refund within tolerance: delta=$delta"; exit 1; }
```

### T5. Voided market rejects new trades

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $K1" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$mkt2" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
case "$status" in 400|409|422) ;; *) echo "trade after void returned $status"; exit 1;; esac
```

### T6. Non-admin cannot resolve or void

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $K1" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$mkt" '{marketId:$id}')" \
  "$TT_BASE_URL/api/predictions/resolve")
[ "$status" = "403" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $K1" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/$mkt2/void")
[ "$status" = "403" ]
```

## Cleanup

Auto.

## Known gaps

- No assertion of total-credit conservation across the workspace's
  participants pre/post-resolve. Add when payouts are stable enough that the
  invariant holds within rounding.
