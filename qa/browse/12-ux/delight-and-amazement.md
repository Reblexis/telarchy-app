---
id: 12-ux-delight-and-amazement
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 240s
goal-horizon: short
goal-statement: |
  As a new user, at least one moment in my first session triggers an "oh
  that's clever" reaction — a chart that animates, a forecast that updates
  visibly, a bot that reacts to my action, a number that lights up. The
  product earns the right to be remembered.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Delight + amazement moments

## What this tests

This is the most subjective spec. It runs a fresh user through the moments
the product has invested in: marketplace counter animation, dashboard chart
zoom, bot-vs-human consensus convergence, post-trade balance flash. Each
moment gets a screenshot and a YES/NO judgement against a checklist.

There is no machine pass/fail. The runner produces a report; a human
reviews it before each release.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+wow-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "WowUser")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
read BOT KEY < <(tt_mkagent "$WS" wowbot)
tt_credit "$WS" "$BOT" 100
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-wow"
checklist="/tmp/$TT_NS-wow/checklist.txt"
:>"$checklist"
mark() { echo "$1" >> "$checklist"; echo "$1"; }
```

## Tests

### M1. Marketplace counter animates from 0 to real numbers

```bash
$B stop
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
sleep 0
$B screenshot "/tmp/$TT_NS-wow/01-counter-0.png"
sleep 1
$B screenshot "/tmp/$TT_NS-wow/02-counter-1.png"
sleep 1
$B screenshot "/tmp/$TT_NS-wow/03-counter-2.png"
mark "M1 counter: see 01/02/03 — does the number visibly tick up?"
```

### M2. Trade is followed by an immediate consensus shift on the chart

```bash
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
# Create a metric + market via API for stability
mid=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"wow-m","type":"leaf","value":50,"marketRangeMax":100}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:30}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-wow/04-pre-trade.png"
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
$B reload && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-wow/05-post-trade.png"
mark "M2 trade: 04 vs 05 — does the consensus visibly shift after a trade?"
```

### M3. Bot reacts to a human metric update within seconds

```bash
# Bot trades after the human moves the metric — consensus should re-shift
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"lower", amount:2}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
$B reload && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-wow/06-bot-reacted.png"
mark "M3 bot: 06 — is the bot's contrarian trade visible in the trades feed?"
```

### M4. Theme transition is smooth (not a flash)

```bash
$B click '.theme-toggle, [data-testid="theme-toggle"], button[aria-label*="theme" i]' || true
$B screenshot "/tmp/$TT_NS-wow/07-theme-toggle.png"
mark "M4 theme: 07 — does the page transition smoothly, not flash white?"
```

### M5. Chart hover shows precise data point

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B click 'button:has-text("Graph"), [data-testid="graph-button"]' || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-wow/08-graph-modal.png"
mark "M5 chart: 08 — does the chart render with data, not a placeholder?"
```

### M6. The first balance is encouraging, not zero

```bash
text=$($B text)
me=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me" \
  | jq -r '.user.balance // .agent.balance // 0')
mark "M6 starting balance: $me (1000 credits is the design)"
[ "$me" != "0" ] || mark "FRICTION new user has 0 balance — they cannot trade without intervention"
```

### M7. Activity feed shows there is life on the platform

```bash
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
text=$($B text)
grep -qiE 'trades this week|active|recently' <<<"$text" \
  && mark "M7 marketplace: shows live signal" \
  || mark "FRICTION marketplace: no liveness signal — looks dead to a new user"
```

## Findings

```bash
echo "--- delight checklist ---"
cat "$checklist"
echo "Screenshots: /tmp/$TT_NS-wow/"
```

## Known gaps

- "Did the user feel delighted" cannot be asserted; this spec produces
  evidence the operator reviews. To turn it into pass/fail, define each
  delight moment quantitatively (e.g. counter must increment ≥3 times in
  2s).
