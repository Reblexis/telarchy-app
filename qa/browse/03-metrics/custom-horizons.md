---
id: 03-metrics-custom-horizons
tags: [api-only, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a workspace admin, I can give a metric custom market horizons (a rolling
  "+2w" offset and a one-shot absolute date), see markets appear at those
  dates, and see the market deactivate when I remove the horizon.
---

# Browse test: Custom market horizons

## What this tests

`timePreference.customHorizons` end-to-end via `PUT /api/metrics/:id` and
`POST /api/predictions/markets/refresh`: creation of markets at custom dates
(curve off), survival across a refresh, deactivation on horizon removal, and
validation rejections. The exponential-curve path is covered implicitly by
`04-markets/void-and-resolve.md`; the EditMetricModal UI by the frontend
component test (`src/components/__tests__/EditMetricModal.test.tsx`).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"horizon-metric","value":10,"marketRangeMax":100,"timePreference":{"enabled":false,"halfLife":1}}' \
  "$TT_BASE_URL/api/metrics")
ID=$(jq -r '.id' <<<"$out")
```

## Tests

### T1. Adding custom horizons spawns markets at the resolved dates

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"timePreference":{"enabled":false,"halfLife":1,"customHorizons":["+2w","2099-12-31"]}}' \
  "$TT_BASE_URL/api/metrics/$ID" >/dev/null
mkts=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets")
n=$(jq '[.[] | select(.metricId == "'$ID'")] | length' <<<"$mkts")
[ "$n" -eq 2 ] || { echo "expected 2 custom-horizon markets, got $n"; exit 1; }
jq -e '[.[] | select(.metricId == "'$ID'") | .targetDate] | index("2099-12-31") != null' <<<"$mkts" >/dev/null
```

The `+2w` market's `targetDate` is an ISO week (`YYYY-Www`) about two weeks
out; the absolute entry appears verbatim.

### T2. Custom markets survive the market refresh

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/refresh" >/dev/null
mkts=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets")
n=$(jq '[.[] | select(.metricId == "'$ID'" and .status == "open")] | length' <<<"$mkts")
[ "$n" -eq 2 ] || { echo "custom markets did not survive refresh: $n open"; exit 1; }
```

### T3. Removing a horizon deactivates its market, keeps the other

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"timePreference":{"enabled":false,"halfLife":1,"customHorizons":["2099-12-31"]}}' \
  "$TT_BASE_URL/api/metrics/$ID" >/dev/null
mkts=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/predictions/markets?status=open")
n=$(jq '[.[] | select(.metricId == "'$ID'")] | length' <<<"$mkts")
[ "$n" -eq 1 ] || { echo "expected 1 open market after removal, got $n"; exit 1; }
jq -e '.[] | select(.metricId == "'$ID'") | .targetDate == "2099-12-31"' <<<"$mkts" >/dev/null
```

### T4. Validation: impossible dates and zero offsets rejected

```bash
for bad in '2026-02-31' '2099-13' '2099-W60' '2099-01-01T24' '+0d' '+0h' 'garbage'; do
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' \
    -X PUT -d '{"timePreference":{"enabled":false,"halfLife":1,"customHorizons":["'$bad'"]}}' \
    "$TT_BASE_URL/api/metrics/$ID")
  [ "$status" = "400" ] || { echo "expected 400 for horizon '$bad', got $status"; exit 1; }
done
```

### T5. Expired absolute dates are pruned, not rejected

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"timePreference":{"enabled":false,"halfLife":1,"customHorizons":["2020-01","2099-12-31"]}}' \
  "$TT_BASE_URL/api/metrics/$ID")
jq -e '.timePreference.customHorizons == ["2099-12-31"]' <<<"$out" >/dev/null
```

## Known gaps

- The rolling re-resolution of `+2w` across day boundaries (old market
  deactivates, new one appears) needs a clock change and is only covered by
  the backend unit tests (`custom-horizons.test.ts`).
- EditMetricModal chip interactions are covered by the frontend component
  test, not by a browser pass here.
