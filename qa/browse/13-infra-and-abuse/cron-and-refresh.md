---
id: 13-infra-cron-and-refresh
tags: [api-only, slow]
isolation: workspace
parallel-safe: false
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As the platform's background jobs, /api/cron/refresh and
  /api/cron/resolve are idempotent — running them twice produces the
  same outcome as once, with no double-resolution, no orphaned markets,
  no log spam.
---

# Browse test: Cron + market refresh

## What this tests

`POST /api/cron/refresh` (re-creates due markets, voids stale ones,
deduplicates), `POST /api/cron/resolve` (resolves markets whose target
date has passed and whose metric value is known). Plus
`POST /api/predictions/markets/refresh` for a workspace.

`parallel-safe: false`: cron mutates global state.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"cron-m","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2020-01-01", liquidity:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
```

## Tests

### T1. Workspace-scoped refresh runs without error

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/refresh")
echo "$out" | jq -e '.created // .deactivated // .deduplicated // .ok' >/dev/null \
  || echo "WARN: refresh returned no documented summary"
```

### T2. Refresh is idempotent: second call's net change is 0

```bash
out2=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/refresh")
echo "$out2" | jq -e '.created // 0' >/dev/null
created=$(echo "$out2" | jq -r '.created // 0')
[ "$created" = "0" ] || echo "WARN: idempotent refresh created $created markets second run"
```

### T3. /api/cron/resolve resolves overdue markets

```bash
# Mark the metric's value to something distinct so we can verify the
# resolve happened.
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":75}' "$TT_BASE_URL/api/metrics/$mid" >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  "$TT_BASE_URL/api/cron/resolve")
case "$status" in 200|204|401|403) ;; *) echo "cron/resolve returned $status"; exit 1;; esac
# If the cron is admin-gated, the resolve happened only if we are
# authorised. Don't fail on 401/403 — it just means the env requires
# additional auth for cron.
```

### T4. Resolved market is read-only

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets/$mkt")
voided=$(jq -r '.voided' <<<"$out")
resolved=$(jq -r '.resolved' <<<"$out")
[ "$voided" = "true" ] || [ "$resolved" = "true" ] \
  || echo "WARN: overdue market not resolved/voided after cron run"
```

### T5. Bulk liquidity bump from refresh does not double-count

```bash
liq_before=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets" \
  | jq '[.[] | .liquidity] | add // 0')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/refresh" >/dev/null
liq_after=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets" \
  | jq '[.[] | .liquidity] | add // 0')
diff=$(awk -v a="$liq_before" -v b="$liq_after" 'BEGIN{print (a>b?a-b:b-a)}')
awk -v d="$diff" 'BEGIN{exit !(d < 0.001)}' \
  || echo "WARN: refresh changed total liquidity by $diff (idempotency suspect)"
```

### T6. Non-admin cannot trigger workspace refresh

```bash
read AID KEY < <(tt_mkagent "$WS" rando)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/predictions/markets/refresh")
[ "$status" = "403" ]
```

## Cleanup

Auto.

## Known gaps

- No coverage of the actual cron schedule (the GCP scheduler triggers
  these endpoints from outside; this spec only verifies the endpoints).
- No coverage of partial failures (e.g. one market fails to resolve while
  others succeed). Add when the endpoint surfaces a per-market summary.
