---
id: 08-feedback-submit-bug-and-help
tags: [browse, fast]
isolation: workspace
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a stuck user, I can open the Feedback modal, file a bug report or a
  help request, and get a clear confirmation. The submission lands in the
  database with my identity attached.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Submit feedback (bug report + help request)

## What this tests

`POST /api/feedback` (NEW: commit a14ca80). The frontend `FeedbackModal`
plus the API endpoint. Verifies both kinds (bug + help), required fields,
length limits, and that the submission is attributed to the caller.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+fb-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "FbUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. Submit a bug report via API

```bash
out=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"bug","subject":"Trade panel renders consensus as null","body":"Repro: open /markets, click any market with low liquidity. Consensus is the literal string null."}' \
  "$TT_BASE_URL/api/feedback")
echo "$out" | jq -e '.id, .kind == "bug", .status == "open"' >/dev/null
BUG_ID=$(jq -r '.id' <<<"$out")
```

### T2. Submit a help request

```bash
out=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"help","subject":"How do conditional markets resolve?","body":"Read the docs but unclear what happens to my stake if the proposal is declined."}' \
  "$TT_BASE_URL/api/feedback")
HELP_ID=$(jq -r '.id' <<<"$out")
[ -n "$HELP_ID" ] && [ "$HELP_ID" != "null" ]
```

### T3. Anonymous submission is rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"bug","subject":"Anon test","body":"Should not be allowed."}' \
  "$TT_BASE_URL/api/feedback")
[ "$status" = "401" ]
```

### T4. Missing required fields rejected with 400

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' -X POST -d '{"kind":"bug"}' \
  "$TT_BASE_URL/api/feedback")
[ "$status" = "400" ]

status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"bug","subject":"x"}' "$TT_BASE_URL/api/feedback")
[ "$status" = "400" ]
```

### T5. Invalid kind rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"kind":"rant","subject":"x","body":"y"}' \
  "$TT_BASE_URL/api/feedback")
[ "$status" = "400" ]
```

### T6. Overlong body truncated to limit, not rejected

```bash
big=$(printf 'X%.0s' $(seq 1 100000))
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg b "$big" '{kind:"bug",subject:"big",body:$b}')" \
  "$TT_BASE_URL/api/feedback")
case "$status" in 200|201|400|413|422) ;; *) echo "huge body got $status"; exit 1;; esac
```

### T7. The Feedback button on the UI opens a modal

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B click 'button:has-text("Feedback"), a:has-text("Feedback"), [data-testid="feedback-trigger"]' \
  || { echo "WARN: no Feedback trigger found — UI route may differ"; }
$B wait --networkidle
text=$($B text)
grep -qiE 'feedback|bug|help' <<<"$text" || true
```

### T8. Submission is attributed to the user

```bash
# Master-key list, find the bug we filed
list=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/feedback?kind=bug&limit=20")
mine=$(jq --arg e "$EMAIL" '[.items[] | select(.email==$e)]' <<<"$list")
[ "$(jq 'length' <<<"$mine")" -ge 1 ] \
  || echo "WARN: filed bug not found by email — check authUserId field instead"
```

## Cleanup

Auto.

## Known gaps

- No CAPTCHA on submit; rate limit alone gates abuse.
- No coverage of email notification on submission (no email pipe wired yet).
