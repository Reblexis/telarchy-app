---
id: 12-ux-persona-day-2-return
tags: [browse, ux, persona]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 240s
goal-horizon: long
goal-statement: |
  Persona: Priya, who signed up two days ago, did one thing, and now
  comes back. The product needs to give her a reason to stay — visible
  changes since last visit, a notification, a forecast that moved.
grader: auto
grade-prompt: |
  You are Priya, returning on day 2 with low intent and high context-loss.
  Score:
  - re-orientation (1-10): can you remember what's where in 5 seconds?
  - signal-of-life (1-10): is there *anything* visibly new since you left?
  - reactivation hook (1-10): a reason to do another action right now?
  Verdict: STAY / NUDGE_NEEDED / BOUNCE. Top 2 frictions.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Persona — Day-2 return

## What this tests

The reactivation moment. The spec simulates day-2 by creating an account,
performing one action, "leaving" (clearing browser state), and coming
back. The product should communicate change while the user was away.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+d2-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "Priya")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-d2"
findings="/tmp/$TT_NS-d2/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. Day 1: sign in, do one thing

```bash
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mid=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/metrics" | jq -r '.[0].id')
[ -n "$mid" ] && [ "$mid" != "null" ] || { react "skip: workspace has no metric"; exit 0; }
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -H "X-Workspace-Id: $WS" -X PUT -d '{"value":42}' \
  "$TT_BASE_URL/api/metrics/$mid" >/dev/null
react "day 1: updated one metric"
$B screenshot "/tmp/$TT_NS-d2/01-day1.png"
```

### T2. Simulate "the world keeps moving" (someone else trades)

```bash
read BOT KEY < <(tt_mkagent "$WS" worldbot)
tt_credit "$WS" "$BOT" 100
mkt=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r --arg m "$mid" '.[] | select(.metricId==$m) | .id' | head -1)
if [ -z "$mkt" ]; then
  mkt=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01"}')" \
    "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
fi
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
react "day 1.5: bot traded — there is news to surface"
```

### T3. Simulate two-day gap by clearing client state

```bash
$B stop
react "user closed laptop, two days passed"
```

### T4. Day 2: log back in

```bash
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-d2/02-day2-landing.png"
text=$($B text)
echo "=== DAY-2 LANDING TEXT ===" >> "$findings"
echo "$text" | head -c 2000 >> "$findings"
```

### T5. Look for "what's new" signals

```bash
grep -qiE 'new|since.*visit|updates|recent activity|notification' <<<"$text" \
  && react "found change-since-last-visit signal" \
  || react "FRICTION: no signal of activity while away"
```

### T6. The traded market — is its consensus visibly different?

```bash
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-d2/03-day2-markets.png"
echo "=== MARKETS TEXT ===" >> "$findings"
$B text | head -c 1500 >> "$findings"
```

### T7. Surface area for nudges

```bash
$B goto "$TT_FRONTEND_URL/account" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-d2/04-day2-account.png"
text=$($B text)
grep -qiE 'P&L|gain|loss|earned|lost' <<<"$text" \
  && react "P&L signal visible — material reason to engage" \
  || react "FRICTION: no P&L surfaced — return user has no anchor"
```

### T8. Print findings

```bash
echo "=== DAY-2 FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-d2/"
```

## Cleanup

Auto.

## Known gaps

- No email/notification channel today; the spec measures only what the
  user sees on the in-product return. When email lands, add a
  "did the day-2 email lead them back" leg.
