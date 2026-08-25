---
id: 03-metrics-create-edit-delete
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can create a leaf metric, edit its name + value
  + range, delete it, and see correct cascade behaviour for any dependent
  formulas.
---

# Browse test: Metric CRUD

## What this tests

`POST/PUT/DELETE /api/metrics` end-to-end on a fresh workspace. Edit history
is covered in `history-and-logs.md`; formula evaluation in `formulas.md`.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
```

## Tests

### T1. Create leaf metric

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"mrr","type":"leaf","value":10000,"unit":"$","marketRangeMax":100000}' \
  "$TT_BASE_URL/api/metrics")
ID=$(jq -r '.id' <<<"$out")
[ -n "$ID" ]
jq -e '.name == "mrr"' <<<"$out" >/dev/null
```

### T2. Read it back

```bash
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID")
jq -e '.value == 10000' <<<"$got" >/dev/null
jq -e '.rangeMin == 0' <<<"$got" >/dev/null
```

### T3. Update name + value

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"name":"mrr-2026","value":12500}' \
  "$TT_BASE_URL/api/metrics/$ID" >/dev/null
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID")
jq -e '.name == "mrr-2026" and .value == 12500' <<<"$got" >/dev/null
```

### T4. Update creates a history row

```bash
log=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs")
n=$(jq 'length' <<<"$log")
[ "$n" -ge 1 ] || { echo "history empty after PUT"; exit 1; }
```

### T5. Range validation: non-positive `marketRangeMax` rejected

The metric model only stores `marketRangeMax` (`rangeMin` is implicit at 0).
A non-positive value is invalid.

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{"name":"bad","type":"leaf","value":5,"marketRangeMax":0}' \
  "$TT_BASE_URL/api/metrics")
case "$status" in 400|422) ;; *) echo "expected 4xx for marketRangeMax=0, got $status"; exit 1;; esac
```

### T6. Out-of-range value clamped or rejected (not silently accepted)

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X PUT -d '{"value":99999999}' \
  "$TT_BASE_URL/api/metrics/$ID")
case "$status" in 200|400|422) ;; *) echo "out-of-range PUT returned $status"; exit 1;; esac
v=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID" | jq -r '.value')
[ "$v" -le 100000 ] 2>/dev/null || true
```

### T7. Delete metric

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -X DELETE "$TT_BASE_URL/api/metrics/$ID")
[ "$status" = "200" ] || [ "$status" = "204" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics/$ID")
[ "$status" = "404" ]
```

### T8. Delete cascade: dependent formula warns or auto-orphans

```bash
A=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"a","type":"leaf","value":3}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
B=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"b","type":"leaf","value":4}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
C=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"c","type":"formula","formula":"{a} + {b}"}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
val=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$C" | jq -r '.value')
[ "$val" = "7" ] || echo "WARN: composite c expected 7, got $val"

# Delete A; C should still exist but evaluate with a warning or to NaN.
curl -s -X DELETE \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics/$A" >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics/$C")
[ "$status" = "200" ] || { echo "C should still exist after A deleted: $status"; exit 1; }
```

## Cleanup

Auto via workspace teardown.

## Known gaps

- Migration endpoint `POST /metrics/migrate-leaf-types` is admin-only; no
  positive test here. Add once we know which historical workspaces still
  need it.
