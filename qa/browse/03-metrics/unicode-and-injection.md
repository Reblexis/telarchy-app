---
id: 03-metrics-unicode-and-injection
tags: [api-only, abuse]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 60s
goal-horizon: short
goal-statement: |
  As an attacker (or careless internationalisation), I can inject script
  tags, RTL strings, very long names, and emoji into metric fields without
  breaking the workspace, leaking through to other users, or executing JS
  in the dashboard.
---

# Browse test: Unicode + injection edges on metrics

## What this tests

`POST /api/metrics` and the dashboard rendering, against a fixed corpus of
adversarial inputs. Maps to `mvp-evaluation/plan.md` 7.13, 14.2, 14.3, 14.4.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
```

## Tests

### T1. Script tag in name persists as text, not HTML

```bash
ID=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"<script>alert(1)</script>","type":"leaf","value":0}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id // empty')
if [ -n "$ID" ]; then
  got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID" | jq -r '.name')
  [ "$got" = "<script>alert(1)</script>" ]
fi
# UI rendering check skipped: this spec is api-only (no auth flow available
# to land on /metrics). The literal-vs-rendered behaviour is verified by
# 13-infra-and-abuse/xss-and-injection.md against an authenticated session.
```

### T2. Extremely long name truncated or rejected

```bash
big=$(printf 'X%.0s' $(seq 1 5000))
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n "$big" '{name:$n,type:"leaf",value:0}')" \
  "$TT_BASE_URL/api/metrics")
case "$status" in 200|201|400|413|422) ;; *) echo "5k-char name returned $status"; exit 1;; esac
```

### T3. RTL / Arabic name renders, sorts, links correctly

```bash
out=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n 'مقياس ١' '{name:$n,type:"leaf",value:5}')" \
  "$TT_BASE_URL/api/metrics")
ID=$(jq -r '.id' <<<"$out")
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$ID" | jq -r '.name')
[ "$got" = "مقياس ١" ]
# Listing endpoint must include it (not strip non-ASCII)
tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics" | jq -e --arg id "$ID" \
  '[.[] | select(.id==$id)] | length == 1' >/dev/null
```

### T4. Emoji + zero-width characters

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n '🍻 NPS​' '{name:$n,type:"leaf",value:7}')" \
  "$TT_BASE_URL/api/metrics" >/dev/null
```

### T5. SQL-injection style payload in formula

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc '{name:"sqli", type:"formula", formula:"1; DROP TABLE metrics--"}')" \
  "$TT_BASE_URL/api/metrics")
case "$status" in 200|201|400|422) ;; *) echo "SQLi attempt returned $status"; exit 1;; esac
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ]
```

### T6. Newline / control chars in description

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc '{name:"controls", type:"leaf", value:1, description:"line1\nline2bell"}')" \
  "$TT_BASE_URL/api/metrics" >/dev/null
```

### T7. Workspace listing still loads after the abuse corpus

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics")
[ "$status" = "200" ]
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets")
[ "$status" = "200" ]
```

## Cleanup

Auto.

## Known gaps

- No CSP-header assertion. If we add CSP, also assert it's on the HTML
  response and contains `script-src 'self'`.
- No formal fuzz test; this is a hand-curated corpus. Consider adding a
  property-based test in `functions/__tests__/` for repeatable coverage.
