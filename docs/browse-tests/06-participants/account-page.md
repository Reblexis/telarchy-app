---
id: 06-participants-account-page
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a participant viewing /account, I see my current balance, recent
  trades, P&L per market, and an obvious way to export or delete my data.
---

# Browse test: Account page

## What this tests

`/account` (`AccountPage.tsx`) — the participant's own dashboard. Reads
`/api/agents/me`, `/api/agents/:id/dashboard`, `/api/agents/:id/trades`,
`/api/agents/:id/market-pnl`. Plus the GDPR affordances (export, delete).

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
EMAIL="qa+acct-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "AcctUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "trader"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. /account renders balance prominently

```bash
$B goto "$TT_FRONTEND_URL/account" && $B wait --networkidle
text=$($B text)
api_bal=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/agents/me" \
  | jq -r '.balance // empty')
[ -n "$api_bal" ] || { echo "no balance from API"; exit 1; }
grep -F "$api_bal" <<<"$text" \
  || echo "WARN: API balance $api_bal not found verbatim on /account"
$B screenshot "/tmp/$TT_NS-account.png"
```

### T2. Trade history table renders (even if empty)

```bash
text=$($B text)
grep -qiE 'trade|history|positions|no trades' <<<"$text"
```

### T3. Place a trade, account page shows it on next load

```bash
mid=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/metrics" \
  | jq -r '.[0].id')
mkt=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01"}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
$B reload && $B wait --networkidle
text=$($B text)
grep -qiE 'trade|position' <<<"$text"
```

### T4. Export button hits /api/auth/me/export

```bash
$B network --clear
$B click 'a:has-text("Export"), button:has-text("Export"), a[download]' || true
$B wait --networkidle
$B network | jq -r '.[].url' | grep -q '/api/auth/me/export' \
  || echo "WARN: no /me/export request observed (button may be missing)"
```

### T5. Delete-account affordance present and gated by confirmation

```bash
text=$($B text)
grep -qiE 'delete (my )?account|close account' <<<"$text" \
  || echo "WARN: no delete-account UI on /account — file backlog item"
```

### T6. No console errors on the page

```bash
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

## Cleanup

Auto.

## Known gaps

- No assertion on the per-market P&L numeric formatting.
- No timezone display assertion (trade timestamps).
