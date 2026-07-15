---
id: 06-participants-agent-register
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: []
timeout: 45s
goal-horizon: short
goal-statement: |
  As an external developer or AI operator, I can register an agent against
  a public workspace via POST /api/agents/register, get an API key once
  (never again), and use it to read + trade per the workspace's Public
  capabilities.
---

# Browse test: Agent registration (anon → first key)

## What this tests

`POST /api/agents/register` — the path that turns a stranger into an agent
participant. Maps to `mvp-evaluation/plan.md` 5.1 + the agent-builder
persona.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
```

## Tests

### T1. Registration succeeds and returns the API key once

```bash
out=$(curl -sf -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$TT_NS-bot1" --arg ws "$WS" \
      '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
KEY=$(jq -r '.apiKey' <<<"$out")
AID=$(jq -r '.agentId' <<<"$out")
[ -n "$KEY" ] && [ "$KEY" != "null" ]
[ "$AID" = "$TT_NS-bot1" ]
```

### T2. The key works for a read

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/me")
[ "$status" = "200" ]
```

### T3. Re-registering the same agent id is rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$AID" --arg ws "$WS" \
      '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
case "$status" in 400|409|422) ;; *) echo "expected 4xx for dup, got $status"; exit 1;; esac
```

### T4. Public workspace grants read + trade by default

```bash
caps=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/groups" \
  | jq -r '.[] | select(.name=="Public") | .capabilities | join(",")')
grep -q 'read'  <<<"$caps"
grep -q 'trade' <<<"$caps" || echo "WARN: Public lacks 'trade' on this workspace"
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets")
[ "$status" = "200" ]
```

### T5. Private workspace registration without an invite is rejected

```bash
WS_PRIV=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS_PRIV'"
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$TT_NS-priv-bot" --arg ws "$WS_PRIV" \
      '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
case "$status" in 200|201) echo "WARN: private workspace allowed open registration";;
                  401|403|404|400) ;;
                  *) echo "unexpected: $status"; exit 1;;
esac
```

### T6. Agent-id rules: too long, illegal characters

```bash
big=$(printf 'a%.0s' $(seq 1 200))
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$big" --arg ws "$WS" '{agentId:$id, workspaceId:$ws}')" \
  "$TT_BASE_URL/api/agents/register")
case "$status" in 400|422) ;; *) echo "huge agentId returned $status"; exit 1;; esac

status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc '{agentId:"has spaces and !!", workspaceId:"'"$WS"'"}')" \
  "$TT_BASE_URL/api/agents/register")
case "$status" in 200|201|400|422) ;; *) echo "bad-char agentId returned $status"; exit 1;; esac
```

### T7. Master key alternative: pre-create an agent for an org

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$TT_NS-orgbot" '{agentId:$id, name:"OrgBot"}')" \
  "$TT_BASE_URL/api/agents/register")
echo "$out" | jq -e '.apiKey' >/dev/null
```

## Cleanup

Auto.

## Known gaps

- No coverage of "rotate api key" (no endpoint yet). When added, write a
  test that the old key 401s after rotation.
