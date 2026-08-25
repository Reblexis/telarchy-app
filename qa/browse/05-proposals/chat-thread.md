---
id: 05-proposals-chat-thread
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As proposer and approver discussing a proposal, I can post messages, see
  them in chronological order, and the read endpoint enforces the same
  capability the rest of the workspace does.
---

# Browse test: Proposal chat thread

## What this tests

`GET / POST /api/proposals/:proposalId/messages`. Verifies ordering, capability
gates (read for `read`, post for `trade`), and that very long messages are
truncated cleanly.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read PROP KP < <(tt_mkagent "$WS" prop)
read APPR KA < <(tt_mkagent "$WS" appr)
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$APPR" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
PROPOSAL=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Chat me","description":"..."}' \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
```

## Tests

### T1. Empty thread returns []

```bash
n=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages" | jq 'length')
[ "$n" = "0" ]
```

### T2. Posts arrive in chronological order

```bash
for body in "looks good?" "needs scope" "ship it"; do
  curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg b "$body" '{content:$b}')" \
    "$TT_BASE_URL/api/proposals/$PROPOSAL/messages" >/dev/null
  sleep 0.1
done
seq=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages" | jq -r '.[].content' | tr '\n' '|')
[ "$seq" = "looks good?|needs scope|ship it|" ]
```

### T3. Approver can post too (admin has trade)

```bash
out=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"content":"approving"}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
echo "$out" | jq -e '.id' >/dev/null
```

### T4. Read-only agent can read but not post

```bash
read RID RKEY < <(tt_mkagent "$WS" reader)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RKEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
[ "$status" = "200" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $RKEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{"content":"x"}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
[ "$status" = "403" ]
```

### T5. Empty body rejected, overlong body truncated or rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{"content":""}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
case "$status" in 400|422) ;; *) echo "empty body returned $status"; exit 1;; esac

big=$(printf 'X%.0s' $(seq 1 20000))
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg b "$big" '{content:$b}')" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
case "$status" in 200|201|400|413|422) ;; *) echo "huge body returned $status"; exit 1;; esac
```

### T6. The thread outlives the decision

The floor keeps a decided contract's conversation open (docs/vision.md,
"the conversation outlives the decision"), so the API must accept a
comment on an approved or declined proposal, not only a pending one.

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/approve" >/dev/null
out=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"content":"delivered, see the number"}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
echo "$out" | jq -e '.id' >/dev/null
```

### T7. Stranger (no membership) cannot read

```bash
WS2=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS2'"
read SID SKEY < <(tt_mkagent "$WS2" stranger)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $SKEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages")
[ "$status" = "403" ] || [ "$status" = "404" ] \
  || { echo "stranger read returned $status"; exit 1; }
```

## Cleanup

Auto.

## Known gaps

- No coverage of pagination if/when the thread grows large.
- No real-time signal: today the UI polls.
