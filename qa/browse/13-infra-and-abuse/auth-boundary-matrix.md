---
id: 13-infra-auth-boundary-matrix
tags: [api-only, abuse]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As an attacker probing every endpoint, I cannot read or write anything
  I do not own. Anonymous → 401. Wrong-workspace → 403/404. Cross-user
  read of /me-style endpoints → blocked.
---

# Browse test: Auth boundary matrix

## What this tests

A representative endpoint per capability, hit four ways:
- anonymous,
- agent key for *another* workspace,
- agent key with insufficient role,
- correct credentials.

The matrix asserts the right status at each cell.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS_A=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS_A'"
WS_B=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS_B'"
read OWN_A KEY_A < <(tt_mkagent "$WS_A" owner)
tt_admin_curl "$WS_A" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$OWN_A" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS_A/members" >/dev/null
read OWN_B KEY_B < <(tt_mkagent "$WS_B" owner)
tt_admin_curl "$WS_B" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$OWN_B" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS_B/members" >/dev/null
read GUEST_A KGA < <(tt_mkagent "$WS_A" guest)
# guest_a is in ws_a but only as default (read), not admin

probe() { # method url status_anon status_wrong_ws status_low_role status_owner
  local m="$1" u="$2" s_anon="$3" s_wrong="$4" s_low="$5" s_owner="$6"
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$u")
  [ "$got" = "$s_anon" ] || echo "FAIL anon $m $u: got $got want $s_anon"
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" \
    -H "X-Agent-Key: $KEY_B" -H "X-Workspace-Id: $WS_A" "$u")
  [ "$got" = "$s_wrong" ] || echo "FAIL wrong-ws $m $u: got $got want $s_wrong"
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" \
    -H "X-Agent-Key: $KGA" -H "X-Workspace-Id: $WS_A" "$u")
  [ "$got" = "$s_low" ] || echo "FAIL low-role $m $u: got $got want $s_low"
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" \
    -H "X-Agent-Key: $KEY_A" -H "X-Workspace-Id: $WS_A" "$u")
  [ "$got" = "$s_owner" ] || echo "FAIL owner $m $u: got $got want $s_owner"
}
```

## Tests

### T1. Read endpoints

```bash
# anon=401, wrong-ws=403, low-role(read)=200, owner=200
probe GET "$TT_BASE_URL/api/metrics" 401 403 200 200
probe GET "$TT_BASE_URL/api/predictions/markets" 401 403 200 200
```

### T2. Manage endpoints (require admin role)

```bash
# anon=401, wrong-ws=403, low-role(reader)=403, owner=200
probe GET "$TT_BASE_URL/api/admin/activity" 401 403 403 200
probe GET "$TT_BASE_URL/api/groups" 401 403 200 200  # read on groups is read
```

### T3. Self-only endpoints

```bash
# /me-style endpoints are 401 anon, but agent key sees its own 'me'
got=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/auth/me")
[ "$got" = "401" ]
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_A" -H "X-Workspace-Id: $WS_A" "$TT_BASE_URL/api/auth/me")
[ "$got" = "200" ]
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_B" -H "X-Workspace-Id: $WS_A" "$TT_BASE_URL/api/auth/me")
[ "$got" = "200" ]  # /me returns the *agent's* own row, regardless of workspace
```

### T4. /:id endpoints reject cross-agent reads

```bash
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY_B" -H "X-Workspace-Id: $WS_A" \
  "$TT_BASE_URL/api/agents/$OWN_A/balance")
[ "$got" = "403" ] || [ "$got" = "404" ] \
  || { echo "agent_b cross-read of agent_a balance returned $got"; exit 1; }
```

### T5. Master key always wins, but requires X-Workspace-Id

```bash
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" "$TT_BASE_URL/api/metrics")
[ "$got" = "400" ] || [ "$got" = "403" ] \
  || echo "WARN: master key without X-Workspace-Id returned $got (want 400)"
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS_A" \
  "$TT_BASE_URL/api/metrics")
[ "$got" = "200" ]
```

### T6. Unknown /api route returns 404, not 500

```bash
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS_A" \
  "$TT_BASE_URL/api/this-does-not-exist-$TT_RUN_ID")
[ "$got" = "404" ]
```

### T7. Agent key with bogus value returns 401

```bash
got=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: not-a-real-key-$TT_RUN_ID" -H "X-Workspace-Id: $WS_A" \
  "$TT_BASE_URL/api/metrics")
[ "$got" = "401" ]
```

## Cleanup

Auto.

## Known gaps

- No coverage of session-cookie tampering (e.g. forged BetterAuth cookie).
  Belongs in a server-side test.
