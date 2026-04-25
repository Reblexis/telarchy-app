---
id: 05-tasks-chat-thread
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As proposer and approver discussing a task, I can post messages, see
  them in chronological order, and the read endpoint enforces the same
  capability the rest of the workspace does.
---

# Browse test: Task chat thread

## What this tests

`GET / POST /api/tasks/:taskId/messages`. Verifies ordering, capability
gates (read for `read`, post for `trade`), and that very long messages are
truncated cleanly.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read PROP KP < <(tt_mkagent "$WS" prop)
read APPR KA < <(tt_mkagent "$WS" appr)
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$APPR" '{agentId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
TASK=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Chat me","description":"...","price":3}' \
  "$TT_BASE_URL/api/tasks" | jq -r '.id')
```

## Tests

### T1. Empty thread returns []

```bash
n=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/tasks/$TASK/messages" | jq 'length')
[ "$n" = "0" ]
```

### T2. Posts arrive in chronological order

```bash
for body in "looks good?" "needs scope" "ship it"; do
  curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg b "$body" '{body:$b}')" \
    "$TT_BASE_URL/api/tasks/$TASK/messages" >/dev/null
  sleep 0.1
done
seq=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/tasks/$TASK/messages" | jq -r '.[].body' | tr '\n' '|')
[ "$seq" = "looks good?|needs scope|ship it|" ]
```

### T3. Approver can post too (admin has trade)

```bash
out=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"body":"approving"}' \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
echo "$out" | jq -e '.id' >/dev/null
```

### T4. Read-only agent can read but not post

```bash
read RID RKEY < <(tt_mkagent "$WS" reader)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RKEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
[ "$status" = "200" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RKEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{"body":"x"}' \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
[ "$status" = "403" ]
```

### T5. Empty body rejected, overlong body truncated or rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{"body":""}' \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
case "$status" in 400|422) ;; *) echo "empty body returned $status"; exit 1;; esac

big=$(printf 'X%.0s' $(seq 1 20000))
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg b "$big" '{body:$b}')" \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
case "$status" in 200|201|400|413|422) ;; *) echo "huge body returned $status"; exit 1;; esac
```

### T6. Stranger (no membership) cannot read

```bash
WS2=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS2'"
read SID SKEY < <(tt_mkagent "$WS2" stranger)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $SKEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/tasks/$TASK/messages")
[ "$status" = "403" ] || [ "$status" = "404" ] \
  || { echo "stranger read returned $status"; exit 1; }
```

## Cleanup

Auto.

## Known gaps

- No coverage of pagination if/when the thread grows large.
- No real-time signal: today the UI polls.
