---
id: 02-workspaces-members-and-permissions
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can add members at different roles (admin /
  trader / member / viewer), change roles later, and have the resulting
  capability matrix actually enforced on subsequent calls.
---

# Browse test: Workspace members + capability matrix

## What this tests

`POST /api/workspaces/:id/members` (add) + the capability gates
(`requireCapability('read'|'trade'|'manage')`) on representative endpoints.
Confirms the roles documented in `docs/agent-economy.md` actually map to the
right capability set.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
WS=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS'"
# create one agent per role; we test capabilities through their keys
for role in admin trader member viewer; do
  read aid akey < <(tt_mkagent "$WS" "$role")
  declare "AID_$role=$aid" "KEY_$role=$akey"
  tt_admin_curl "$WS" -H 'Content-Type: application/json' \
    -X POST -d "$(jq -nc --arg id "$aid" --arg r "$role" '{agentId:$id, role:$r}')" \
    "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
done
# fixture: one metric so trade / read paths have something to hit
metric_id=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"perm-metric","type":"leaf","value":10}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
market_id=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$metric_id" '{metricId:$m, targetDate:"2030-01-01"}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
```

## Tests

### T1. Viewer can read but not trade or manage

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_viewer" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ] || { echo "viewer read denied: $status"; exit 1; }

status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_viewer" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$market_id" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
[ "$status" = "403" ] || { echo "viewer trade allowed: $status"; exit 1; }

status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_viewer" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"name":"viewer-cant","type":"leaf","value":0}' \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "403" ] || { echo "viewer manage allowed: $status"; exit 1; }
```

### T2. Trader can read + trade, but not manage

```bash
tt_credit "$WS" "$AID_trader" 100
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_trader" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$market_id" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
[ "$status" = "200" ] || [ "$status" = "201" ] \
  || { echo "trader trade denied: $status"; exit 1; }

status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_trader" -H "X-Workspace-Id: $WS" \
  -X DELETE "$TT_BASE_URL/api/predictions/markets/$market_id")
[ "$status" = "403" ] || { echo "trader market-delete allowed: $status"; exit 1; }
```

### T3. Admin can manage

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_admin" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"name":"admin-yes","type":"leaf","value":0}' \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "201" ] || [ "$status" = "200" ] \
  || { echo "admin metric-create denied: $status"; exit 1; }
```

### T4. Member is the middle role: read + trade only

```bash
tt_credit "$WS" "$AID_member" 100
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_member" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets")
[ "$status" = "200" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_member" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$market_id" '{marketId:$id, direction:"lower", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade")
[ "$status" = "200" ] || [ "$status" = "201" ] \
  || { echo "member trade denied: $status"; exit 1; }
```

### T5. Role change takes effect on next request

```bash
# promote viewer to admin
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$AID_viewer" '{agentId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null

status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_viewer" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"name":"now-i-can","type":"leaf","value":0}' \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "201" ] || [ "$status" = "200" ] \
  || { echo "promoted viewer cannot manage: $status"; exit 1; }
```

### T6. Email-based add (browser-side flow)

```bash
EMAIL="qa+memb-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "MembUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg e "$EMAIL" '{email:$e, role:"trader"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members")
[ "$status" = "201" ] || [ "$status" = "200" ]
# user can now read this private workspace
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ]
```

## Cleanup

Auto.

## Known gaps

- No coverage of capability `manage:groups` distinct from `manage`.
- Removing a member is only via direct DB delete today; once `DELETE
  /:id/members/:agentId` exists, add a test.
