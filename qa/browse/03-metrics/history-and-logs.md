---
id: 03-metrics-history-and-logs
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 45s
goal-horizon: short
goal-statement: |
  As an admin auditing how a metric moved, I can read every value change
  with a timestamp via /api/metrics/:id/logs, and the API exposes the same
  data the chart renders.
---

# Browse test: Metric history + audit log

## What this tests

`GET /api/metrics/:id/logs` — the per-metric log of value changes that
backs the time chart. Also `POST /api/metrics/logs/purge` (admin-only).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
ID=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"history-test","type":"leaf","value":10}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
```

## Tests

### T1. Initial create produces one log row

```bash
n=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq 'length')
[ "$n" -ge 1 ]
```

### T2. Each PUT adds a log row

```bash
before=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq 'length')
for v in 11 12 13; do
  tt_admin_curl "$WS" -H 'Content-Type: application/json' \
    -X PUT -d "{\"value\":$v}" \
    "$TT_BASE_URL/api/metrics/$ID" >/dev/null
done
after=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq 'length')
delta=$(( after - before ))
[ "$delta" = "3" ] || { echo "expected +3 log rows, got +$delta"; exit 1; }
```

### T3. Logs are timestamped + ordered chronologically

```bash
ts=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" \
  | jq -r '.[].createdAt // .[].timestamp' | sort -c) || {
  echo "logs not in chronological order"; exit 1; }
```

### T4. Logs include the changing field (value or formula)

```bash
last=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq '.[-1]')
echo "$last" | jq -e '.value // .newValue' >/dev/null \
  || { echo "log row missing value field"; exit 1; }
```

### T5. Logs visible to read-capability participants

```bash
read AID KEY < <(tt_mkagent "$WS" reader)
# default group capability includes read on private workspaces
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics/$ID/logs")
[ "$status" = "200" ] || { echo "reader denied logs: $status"; exit 1; }
```

### T6. Purge requires manage; bumps log count down

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/metrics/logs/purge")
[ "$status" = "403" ] || { echo "reader allowed purge: $status"; exit 1; }

before=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq 'length')
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$ID" '{metricId:$id, keepLast:1}')" \
  "$TT_BASE_URL/api/metrics/logs/purge" >/dev/null
after=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID/logs" | jq 'length')
[ "$after" -lt "$before" ] || { echo "purge did not reduce row count ($before → $after)"; exit 1; }
```

## Cleanup

Auto.

## Known gaps

- No coverage of log pagination — endpoint may return all rows today; add a
  test once `?limit=` is documented.
- No assertion that log rows attribute the change to the right participant
  (PII consideration: do we expose actor across roles?).
- The graph modal's granularity dropdown (Hourly last-7-days / Daily / Weekly
  / Monthly / Yearly, added 2026-06-06) is covered by the frontend component
  test (`GraphModal.test.tsx`), not by a browser pass here. A browser test
  would: open Graph on a metric with logs, select "Hourly (last 7 days)" in
  the "History granularity" combobox, and assert the chart re-renders with
  more points and the window clamps to the trailing week.
- The "Show past predictions" toggle (added 2026-06-06: hollow points for the
  final consensus of resolved/closed markets; clicking one deep-links to
  /markets?marketId=<id>&status=all) is covered by `GraphModal.test.tsx`, not
  by a browser pass here.
- Clicking a point on the inline metric card's forecast chart deep-links to
  `/markets?metric=<metricId>&target=<date>` (scopes the markets list to that
  metric's own / child markets at the clicked date, not every market on the
  date). The scoping assertion lives in `qa/browse/04-markets/browse-and-trade.md`
  T11; the click-to-URL wiring is `MetricCard`'s `onPointClick`.
