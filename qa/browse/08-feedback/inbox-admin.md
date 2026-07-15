---
id: 08-feedback-inbox-admin
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 45s
goal-horizon: short
goal-statement: |
  As a platform admin, I can list all feedback, filter by kind/status,
  read counts via /stats, and only platform-admin / master-key callers
  can do these.
---

# Browse test: Feedback inbox (admin list + stats)

## What this tests

`GET /api/feedback` (list) and `GET /api/feedback/stats`. Both require
platform-admin (`agents.platformAdmin = true`) or master-key.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
EMAIL="qa+inbox-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "InboxUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
# Submit two bugs and one help
for body in '{"kind":"bug","subject":"a","body":"x"}' \
            '{"kind":"bug","subject":"b","body":"x"}' \
            '{"kind":"help","subject":"c","body":"x"}'; do
  curl -sf -b "$JAR" -H 'Content-Type: application/json' -X POST \
    -d "$body" "$TT_BASE_URL/api/feedback" >/dev/null
done
```

## Tests

### T1. List returns recent submissions newest-first

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?limit=10")
n=$(jq '.items | length' <<<"$out")
[ "$n" -ge 3 ] || echo "WARN: list returned $n items (expected ≥3 from this run)"
ts=$(jq -r '.items[].createdAt' <<<"$out" | sort -rc) || {
  echo "list not in newest-first order"; exit 1; }
```

### T2. Filter by kind=bug

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?kind=bug&limit=20")
all_bug=$(jq -r '.items[] | .kind' <<<"$out" | sort -u)
[ "$all_bug" = "bug" ]
```

### T3. Filter by status=open returns only open ones

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?status=open&limit=20")
all_open=$(jq -r '.items[] | .status' <<<"$out" | sort -u)
[ "$all_open" = "open" ]
```

### T4. /stats returns grouped counts

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback/stats")
echo "$out" | jq -e '.groups' >/dev/null
n=$(jq '.groups | length' <<<"$out")
[ "$n" -ge 1 ]
```

### T5. Non-admin agent gets 403

```bash
read AID KEY < <(tt_mkagent "$WS" peeker)
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/feedback")
[ "$status" = "403" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/feedback/stats")
[ "$status" = "403" ]
```

### T6. Anonymous gets 403

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_BASE_URL/api/feedback")
[ "$status" = "403" ] || [ "$status" = "401" ]
```

### T7. limit cap clamped to 500

```bash
out=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?limit=10000")
n=$(jq '.items | length' <<<"$out")
[ "$n" -le 500 ]
```

## Cleanup

Auto. Test feedback rows are tagged by `email = qa+inbox-...`; safe to
leave behind.

## Known gaps

- No coverage of an "assignee" field; not yet in the schema.
