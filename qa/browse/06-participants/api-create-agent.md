---
id: 06-participants-api-create-agent
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can use POST /api/agents to register a new bot
  participant under my ownership, add it to one or more workspaces' groups
  in a single call, and have its first key issued with a non-default scope
  set. The endpoint refuses to add the agent to workspaces I cannot
  administer, and refuses to grant scopes broader than my own (when called
  from a key, not a session).
---

# Browse test: Authenticated agent creation (POST /api/agents)

## What this tests

This is the API-side equivalent of the "Register a new bot" form on the
API page. The unauth `POST /api/agents/register` (third-party self-signup)
keeps existing behavior; this new endpoint adds the ownership + scoped
key + multi-workspace memberships flow that the UI needs.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"

# A signed-in browser session (the typical caller of this endpoint).
JAR="/tmp/$TT_NS-owner.jar"
curl -sf -c "$JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$TT_BASE_URL/api/auth/sign-in/email" >/dev/null

# A workspace where the signed-in user has manage capability. We use the
# default workspace (the test user is its admin/owner per AGENTS.md).
WS=default
TRADER_GID=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/groups" | jq -r '.[] | select(.type=="trader") | .id')
[ -n "$TRADER_GID" ] && [ "$TRADER_GID" != "null" ]
```

## Tests

### T1. Create succeeds and returns the key once

```bash
# Short suffix so agentId stays under the 64-char validation cap even when
# TT_NS is long.
SUFFIX="$$-$RANDOM"
ID="bot1-$SUFFIX"
res=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" -H "Content-Type: application/json" \
  -X POST "$TT_BASE_URL/api/agents" \
  -d "$(jq -nc --arg id "$ID" --arg ws "$WS" --arg g "$TRADER_GID" \
      '{agentId:$id, keyLabel:"prod", keyScopes:["workspace:read","workspace:trade"], memberships:[{workspaceId:$ws, groupIds:[$g]}]}')")
[ "$(jq -r '.agentId' <<<"$res")" = "$ID" ]
KEY=$(jq -r '.apiKey' <<<"$res")
[ -n "$KEY" ] && [ "$KEY" != "null" ]
jq -e '.scopes == ["workspace:read","workspace:trade"]' <<<"$res" >/dev/null
jq -e '.label == "prod"' <<<"$res" >/dev/null
jq -e '.keyId | length == 36' <<<"$res" >/dev/null
```

### T2. The new agent shows up in /api/agents/mine for the owner

```bash
mine=$(curl -sf -b "$JAR" "$TT_BASE_URL/api/agents/mine")
jq -e --arg id "$ID" 'any(.[]; .id==$id)' <<<"$mine" >/dev/null
```

### T3. The new key works and is scoped to read+trade

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/status")
[ "$code" = "200" ]

# Out-of-scope account endpoints must be 403.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -X POST -H "Content-Type: application/json" \
  -d '{"intent":"creator"}' "$TT_BASE_URL/api/auth/profile")
[ "$code" = "403" ]
```

### T4. Membership in the requested group was actually applied

```bash
groups=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/groups")
jq -e --arg gid "$TRADER_GID" --arg id "$ID" \
  '.[] | select(.id==$gid) | .memberIds | any(.[]; . == $id)' <<<"$groups" >/dev/null
```

### T5. Re-creating the same agentId is rejected

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$JAR" -H "X-Workspace-Id: $WS" -H "Content-Type: application/json" \
  -X POST "$TT_BASE_URL/api/agents" \
  -d "$(jq -nc --arg id "$ID" '{agentId:$id, memberships:[]}')")
case "$code" in 400|409|422) ;; *) echo "expected 4xx for dup, got $code"; exit 1;; esac
```

### T6. memberships into an unmanaged workspace are refused

```bash
# Sign in as a different user that has no manage anywhere, then try to
# add a bot into the default workspace.
EMAIL="stranger-$SUFFIX@example.test"
JAR2=$(tt_mkuser "$EMAIL" "Test1234!" "Stranger") || { echo "tt_mkuser failed"; exit 1; }
[ -s "$JAR2" ] || { echo "stranger jar is empty: $JAR2"; exit 1; }
ID2="bot2-$SUFFIX"
out=$(mktemp)
code=$(curl -s -o "$out" -w '%{http_code}' \
  -b "$JAR2" -H "X-Workspace-Id: $WS" -H "Content-Type: application/json" \
  -X POST "$TT_BASE_URL/api/agents" \
  -d "$(jq -nc --arg id "$ID2" --arg ws "$WS" --arg g "$TRADER_GID" \
      '{agentId:$id, memberships:[{workspaceId:$ws, groupIds:[$g]}]}')")
case "$code" in 403) ;;
  *) echo "expected 403 unauthorized membership, got $code"; echo "body: $(cat "$out")"; exit 1;;
esac
rm -f "$out"
```

### T7. Memberships referencing groups outside the workspace are refused

```bash
# Make a fresh workspace so we can prove cross-workspace group ids fail.
WS2=$(tt_mkworkspace blank private)
tt_on_cleanup "tt_rm_workspace '$WS2'"

# Pull a Trader group from WS (different workspace) and try to use it in WS2.
ID3="bot3-$SUFFIX"
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$JAR" -H "X-Workspace-Id: $WS2" -H "Content-Type: application/json" \
  -X POST "$TT_BASE_URL/api/agents" \
  -d "$(jq -nc --arg id "$ID3" --arg ws "$WS2" --arg g "$TRADER_GID" \
      '{agentId:$id, memberships:[{workspaceId:$ws, groupIds:[$g]}]}')")
case "$code" in 400) ;; *) echo "expected 400 cross-ws group, got $code"; exit 1;; esac
```

## Cleanup

```bash
tt_on_cleanup "tt_rm_agent 'bot1-$SUFFIX' '$WS' || true"
```

## Known gaps

- T6 relies on `tt_mkuser` (which signs up a fresh account, requiring open
  signups). If the deployment forces invite-only signup it will fail and
  should be skipped.
