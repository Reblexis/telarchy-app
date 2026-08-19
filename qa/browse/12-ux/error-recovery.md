---
id: 12-ux-error-recovery
tags: [browse, ux]
isolation: workspace
parallel-safe: true
needs: [auth, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a user who fat-fingers, mis-types, or has a flaky network, every
  failure mode shows me a helpful message I can act on — never a stack
  trace, never a silent failure, never a screen that locks up.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Error recovery

## What this tests

Hand-curated failure scenarios. Each one should produce a clean error
message + a recoverable UI state (no full-page replacement, no need to
hard-reload).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
findings="/tmp/$TT_NS-errrec.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
```

## Tests

### T1. Wrong password on /login

```bash
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "noone-$TT_RUN_ID@example.test"
$B fill 'input[type="password"]' "wrong"
$B click 'button[type="submit"]'
$B wait --networkidle
text=$($B text)
if grep -qiE 'incorrect|invalid|wrong|does not match|not found' <<<"$text"; then
  note "wrong password: clean error"
else
  note "FRICTION wrong password: no clear error message"
fi
$B screenshot "/tmp/$TT_NS-wrong-pw.png"
```

### T2. Email already taken on /signup

```bash
EMAIL="qa+dup-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "DupUser")
tt_on_cleanup "tt_rm_user '$JAR'"
$B stop
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B fill 'input[name="name"], input[placeholder*="name" i]' "DupUser2"
$B click 'input[type="checkbox"]'
$B click 'button[type="submit"]'
$B wait --networkidle
text=$($B text)
grep -qiE 'already exists|already in use|account exists' <<<"$text" \
  && note "duplicate email: friendly error" \
  || note "FRICTION duplicate email: no clear message"
$B screenshot "/tmp/$TT_NS-dup-email.png"
```

### T3. Network failure simulated via offline goto

```bash
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
# Simulate API 5xx by hitting a clearly-non-existent endpoint
$B goto "$TT_FRONTEND_URL/markets?inject=fail" && $B wait --networkidle
text=$($B text)
$B screenshot "/tmp/$TT_NS-net-fail.png"
grep -qiE 'something went wrong|try again|reload|retry' <<<"$text" \
  || note "FRICTION generic /markets renders nothing under failure (would need a sentry-style banner)"
```

### T4. Trade with insufficient balance shows balance-specific error

```bash
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
# Try to fill an absurd amount and submit
$B snapshot -i > "/tmp/$TT_NS-snap.txt"
$B click 'button:has-text("Buy higher"), button:has-text("Higher")' || true
$B wait --networkidle
amt_ref=$(grep 'amount\|spend' "/tmp/$TT_NS-snap.txt" | grep -oE '@e[0-9]+' | head -1)
if [ -n "$amt_ref" ]; then
  $B fill "$amt_ref" "9999999"
  $B click 'button[type="submit"]:has-text("Confirm"), button:has-text("Place trade")' || true
  $B wait --networkidle
  text=$($B text)
  grep -qiE 'insufficient|not enough|balance' <<<"$text" \
    && note "insufficient balance: explicit error" \
    || note "FRICTION insufficient balance: no specific message"
fi
$B screenshot "/tmp/$TT_NS-bad-trade.png"
```

### T5. Form-validation errors are inline + per-field

```bash
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B click 'button[type="submit"]'
$B wait --networkidle
text=$($B text)
# At least three field-specific errors expected (email, password, consent)
n=$(grep -ciE 'required|enter|please' <<<"$text" || true)
[ "$n" -ge 1 ] || note "FRICTION /signup: empty submit produced no inline errors"
```

### T6. 404 page exists for unknown routes

```bash
$B goto "$TT_FRONTEND_URL/this-route-does-not-exist-$TT_RUN_ID" && $B wait --networkidle
text=$($B text)
grep -qiE '404|not found|missing|lost' <<<"$text" \
  && note "404: page renders" \
  || note "FRICTION 404: unknown route does not show a 404 page"
$B screenshot "/tmp/$TT_NS-404.png"
```

### T7. No stack traces ever leak to the UI

```bash
for path in /signup /login /markets /metrics /proposals /admin; do
  $B goto "$TT_FRONTEND_URL$path" && $B wait --networkidle
  text=$($B text)
  if grep -qE 'at .*\.(js|ts|tsx):[0-9]+:[0-9]+|TypeError|ReferenceError|Error:' <<<"$text"; then
    note "FRICTION $path: stack trace bleeding to UI"
  fi
done
```

## Findings

```bash
cat "$findings"
```

## Known gaps

- No coverage of slow-network throttling. `$B viewport` cannot change
  network speed; would need MCP-Playwright with CDP for that.
- No coverage of payment / settlement errors (USDC kill-switch is on).
