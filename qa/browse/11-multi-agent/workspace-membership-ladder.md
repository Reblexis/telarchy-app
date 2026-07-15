---
id: 11-multi-agent-workspace-membership-ladder
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: long
goal-statement: |
  As a workspace evolving over time, a stranger discovers it via the
  marketplace, joins as a Public-group reader, gets promoted to trader
  after demonstrating intent, and finally to admin — at each rung the
  capability matrix is honest about what they can do.
---

# Browse test: Workspace membership ladder (over time)

## What this tests

The progression Public → Member → Trader → Admin. Each rung is
representative of the kind of trust the workspace owner extends to a
new collaborator. The spec verifies the platform supports this ladder
without re-onboarding (no re-signup, no key rotation).

Long-horizon: in real life this happens over weeks. The spec compresses it
to one run by simulating the promotions back-to-back.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read STR KEY < <(tt_mkagent "$WS" stranger)
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"ladder-m","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:20}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')

cap_status() { # $1 method, $2 path, $3 body
  curl -s -o /dev/null -w '%{http_code}' \
    -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X "$1" \
    ${3:+-d "$3"} "$TT_BASE_URL$2"
}
promote() { # $1 role
  tt_admin_curl "$WS" -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$STR" --arg r "$1" '{participantId:$id, role:$r}')" \
    "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
}
```

## Tests

### T1. Public-only: read yes, trade no, manage no

```bash
[ "$(cap_status GET "/api/predictions/markets")"  = "200" ]
# trade: depends on the workspace's Public-group caps. We created `blank
# public` which currently grants read+trade on Public per template.
# So trade may succeed; we focus on the manage gate.
[ "$(cap_status POST "/api/metrics" '{"name":"x","type":"leaf","value":0}')" = "403" ]
```

### T2. Promote to viewer: read only, even if Public had trade

```bash
promote viewer
[ "$(cap_status GET "/api/predictions/markets")" = "200" ]
[ "$(cap_status POST "/api/predictions/trade" "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')")" = "403" ]
```

### T3. Promote to trader: trade succeeds

```bash
promote trader
tt_credit "$WS" "$STR" 100
status=$(cap_status POST "/api/predictions/trade" "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')")
[ "$status" = "200" ] || [ "$status" = "201" ]
```

### T4. Promote to admin: manage succeeds

```bash
promote admin
status=$(cap_status POST "/api/metrics" '{"name":"by-promoted","type":"leaf","value":0}')
[ "$status" = "200" ] || [ "$status" = "201" ]
```

### T5. Demote back to viewer: manage immediately fails again

```bash
promote viewer
[ "$(cap_status POST "/api/metrics" '{"name":"by-demoted","type":"leaf","value":0}')" = "403" ]
```

### T6. The agent's API key never rotates across promotions

```bash
status=$(cap_status GET "/api/agents/me")
[ "$status" = "200" ]
```

### T7. Removing the agent (manage:admin) makes their key 403 in this workspace

```bash
tt_rm_agent "$WS" "$STR"
status=$(cap_status GET "/api/predictions/markets")
[ "$status" = "401" ] || [ "$status" = "403" ] || [ "$status" = "404" ]
```

## Cleanup

Auto.

## Known gaps

- No coverage of demote-from-admin-to-not-a-member-at-all yet; relies on
  full delete via DELETE /api/agents/:id.
- Long-horizon truncated; if you want a real-time staged test, schedule
  via `loop` and re-fire with the same fixtures.
