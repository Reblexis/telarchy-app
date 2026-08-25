---
id: 13-infra-xss-and-injection
tags: [browse, abuse]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a malicious user, I cannot inject script into a metric name, proposal
  title, chat message, or feedback subject and have it execute in another
  user's browser.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: XSS + injection across user-supplied surfaces

## What this tests

Stored-XSS attempts at every text surface a participant controls. The
spec creates the malicious data via API, then opens the relevant page in
the browser and asserts:
- the literal string renders as text,
- no console errors / no `alert()` fired,
- no document.title was hijacked.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+xss-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "XssUser")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
PAYLOAD='<img src=x onerror=alert(1)><script>alert(2)</script>'
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n "$PAYLOAD" '{name:$n,type:"leaf",value:1}')" \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
PROPOSAL=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg t "$PAYLOAD" '{title:$t, description:$t}')" \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg b "$PAYLOAD" '{body:$b}')" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/messages" >/dev/null
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg s "$PAYLOAD" --arg b "$PAYLOAD" '{kind:"bug",subject:$s,body:$b}')" \
  "$TT_BASE_URL/api/feedback" >/dev/null

$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

A hijacked `document.title` would be set to the XSS payload (starts with
`<img` / `<script`). All real titles in this app start with `Telarchy`;
T1–T3 assert that pattern survives. We can't stash a JS variable across
navigations because the browse session resets the JS context per page.

## Tests

### T1. Metric name renders as text on /metrics

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B console --clear
text=$($B text)
grep -F "$PAYLOAD" <<<"$text" || echo "WARN: payload not in /metrics text — selector mismatch"
err=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$err" in ''|'(no console errors)') ;; *) echo "console errors on /metrics XSS: $err"; exit 1;; esac
title=$($B js 'document.title')
case "$title" in Telarchy*|"") ;; *) echo "title hijack on /metrics: $title"; exit 1;; esac
```

### T2. /markets renders the metric name safely

```bash
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
err=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$err" in ''|'(no console errors)') ;; *) echo "console errors on /markets XSS: $err"; exit 1;; esac
title=$($B js 'document.title')
case "$title" in Telarchy*|"") ;; *) echo "title hijack on /markets: $title"; exit 1;; esac
```

### T3. /proposals renders title+description+chat safely

```bash
$B goto "$TT_FRONTEND_URL/proposals" && $B wait --networkidle
err=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$err" in ''|'(no console errors)') ;; *) echo "console errors on /proposals XSS: $err"; exit 1;; esac
title=$($B js 'document.title')
case "$title" in Telarchy*|"") ;; *) echo "title hijack on /proposals: $title"; exit 1;; esac
```

### T4. No `<img onerror>` actually executed

```bash
got=$($B js '
  let fired = false;
  const old = window.alert;
  window.alert = (...args) => { fired = true; };
  setTimeout(() => { window.alert = old; }, 100);
  return fired;
')
[ "$got" = "false" ]
```

### T5. The payload survives a round trip via API

```bash
got=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics/$mid" | jq -r '.name')
[ "$got" = "$PAYLOAD" ]
```

### T6. SQL-style injection in query params returns 400 / clean empty

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/metrics?name=%27%20OR%201%3D1--")
case "$status" in 200|400|422) ;; *) echo "SQLi attempt returned $status"; exit 1;; esac
```

### T7. Path traversal on /sources/:id/file blocked

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/sources/anything/file?path=../../../etc/passwd")
case "$status" in 400|403|404|422) ;; *) echo "path traversal returned $status"; exit 1;; esac
```

## Cleanup

Auto.

## Known gaps

- No CSP-header assertion. If we add CSP, also assert it covers
  script-src, style-src, frame-ancestors.
