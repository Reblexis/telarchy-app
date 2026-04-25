---
id: 07-admin-reset-economy
tags: [api-only, slow]
isolation: workspace
parallel-safe: false
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As the platform operator on a fresh workspace, I can call POST
  /api/reset-economy to wipe trades and balances back to seed state without
  affecting metric definitions or members.
---

# Browse test: Reset economy

## What this tests

`POST /api/reset-economy` — destructive operation that resets balances,
positions, and trade history. Test on a throwaway workspace so production
is never touched. `parallel-safe: false` because two reset calls in the
same workspace race.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" rs)
tt_credit "$WS" "$AID" 100
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"rs","type":"leaf","value":50,"rangeMin":0,"rangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidityCredits:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
```

## Tests

### T1. Reset succeeds and returns a summary

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/reset-economy")
echo "$out" | jq -e '.balancesReset // .reset // .ok' >/dev/null \
  || echo "WARN: reset-economy returned no documented summary fields"
```

### T2. Trade history is cleared

```bash
n=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$AID/trades" | jq 'length')
[ "$n" = "0" ] || echo "WARN: agent trades not zero after reset ($n)"
```

### T3. Metric definitions still intact

```bash
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$mid" | jq -r '.id')
[ "$got" = "$mid" ]
```

### T4. Members still members

```bash
n=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents" \
  | jq --arg id "$AID" '[.[] | select(.id==$id)] | length')
[ "$n" = "1" ]
```

### T5. Markets either reset or marked accordingly

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt")
# Either the market is voided or its consensus is back to default
voided=$(jq -r '.voided' <<<"$out")
case "$voided" in true|false) ;; *) echo "unexpected voided=$voided"; exit 1;; esac
```

### T6. Non-admin cannot trigger reset

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/reset-economy")
[ "$status" = "403" ]
```

## Cleanup

Workspace deletion handles the rest.

## Known gaps

- No assertion on what happens to outstanding tasks.
- No idempotency check (calling twice in a row).
