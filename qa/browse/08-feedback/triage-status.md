---
id: 08-feedback-triage-status
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 30s
goal-horizon: short
goal-statement: |
  As a platform admin, I can change a feedback row's status (open →
  triaged → resolved) and add private admin notes; only admins can.
---

# Browse test: Feedback triage (PATCH)

## What this tests

`PATCH /api/feedback/:id`. Status workflow + notes.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
EMAIL="qa+triage-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "TriUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
ID=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"bug","subject":"triage me","body":"x"}' \
  "$TT_BASE_URL/api/feedback" | jq -r '.id')
```

## Tests

### T1. PATCH status=triaged

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PATCH -d '{"status":"triaged"}' \
  "$TT_BASE_URL/api/feedback/$ID")
jq -e '.status == "triaged"' <<<"$out" >/dev/null
```

### T2. PATCH adminNotes

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PATCH -d '{"adminNotes":"likely user confusion"}' \
  "$TT_BASE_URL/api/feedback/$ID" >/dev/null
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?limit=50")
note=$(jq -r --arg id "$ID" '.items[] | select(.id==$id) | .adminNotes' <<<"$out")
[ "$note" = "likely user confusion" ]
```

### T3. Invalid status rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PATCH -d '{"status":"deleted"}' \
  "$TT_BASE_URL/api/feedback/$ID")
[ "$status" = "400" ]
```

### T4. Empty PATCH rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PATCH -d '{}' \
  "$TT_BASE_URL/api/feedback/$ID")
[ "$status" = "400" ]
```

### T5. Non-admin cannot PATCH

```bash
read AID KEY < <(tt_mkagent "$WS" rando)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PATCH -d '{"status":"resolved"}' \
  "$TT_BASE_URL/api/feedback/$ID")
[ "$status" = "403" ]
```

### T6. PATCH on unknown id returns 404

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PATCH -d '{"status":"resolved"}' \
  "$TT_BASE_URL/api/feedback/nope-$TT_RUN_ID")
[ "$status" = "404" ]
```

### T7. updatedAt advances

```bash
before=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?limit=20" \
  | jq -r --arg id "$ID" '.items[] | select(.id==$id) | .updatedAt')
sleep 1
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PATCH -d '{"status":"resolved"}' \
  "$TT_BASE_URL/api/feedback/$ID" >/dev/null
after=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?limit=20" \
  | jq -r --arg id "$ID" '.items[] | select(.id==$id) | .updatedAt')
[ "$before" != "$after" ] || { echo "updatedAt did not move"; exit 1; }
```

## Cleanup

Auto. Rows linger; benign.

## Known gaps

- No PATCH-by-author flow (today only platform admin can edit). If a
  "user can amend their own bug" feature lands, add a test.
