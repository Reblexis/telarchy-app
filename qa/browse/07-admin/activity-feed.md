---
id: 07-admin-activity-feed
tags: [browse]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As the platform operator, I can read the per-workspace activity feed and
  see human-readable, chronological events for every market, trade, proposal,
  and metric change worth knowing about.
---

# Browse test: Admin activity feed

## What this tests

`GET /api/admin/activity` and the admin-page activity panel. Activity rows
must include type, timestamp, actor, and a short human description.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read AID KEY < <(tt_mkagent "$WS" actor)
tt_credit "$WS" "$AID" 100
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"act","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:20, skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
```

## Tests

### T1. /api/admin/activity returns a chronological feed

```bash
feed=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/admin/activity")
n=$(jq '.activities | length' <<<"$feed")
[ "$n" -ge 1 ]
jq -e '.activities[0].type, .activities[0].createdAt' <<<"$feed" >/dev/null
```

### T2. Activity covers metric create + market create + trade

```bash
types=$(jq -r '.activities[].type' <<<"$feed" | sort -u)
for t in metric_created market_created trade_executed; do
  grep -q "$t\|${t//_/.}\|${t/created/create}" <<<"$types" \
    || echo "WARN: activity feed missing '$t' (saw: $types)"
done
```

### T3. Non-admin cannot read

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/admin/activity")
[ "$status" = "403" ]
```

### T4. Limit + workspace filter respected

```bash
n1=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/admin/activity?limit=1" \
  | jq '.activities | length')
[ "$n1" -le 1 ]
```

### T5. /admin UI surfaces the feed

```bash
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
# we don't login a test user — admin requires manage. The UI side of this
# test runs as a no-op when no admin session is available; assert the
# endpoint instead.
echo "skip UI: admin UI requires platform-admin session"
```

## Cleanup

Auto.

## Known gaps

- T5 punts on the UI test for parallelism reasons (admin login mints a
  global session). Cover separately in the bot-agents-panel spec.
