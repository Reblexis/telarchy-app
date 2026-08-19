---
id: 12-ux-first-five-minutes
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 600s
goal-horizon: long
goal-statement: |
  As a stranger arriving at telarchy.com for the first time, within 5
  minutes I can: understand what this is, sign up, land somewhere useful,
  do one thing that produces a visible result, and feel I want to return.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: First five minutes

## What this tests

This is the longest and most important UX spec. Functionality is not the
question — every step here passes individually elsewhere. The question is
whether the *whole arc* feels coherent: does a stranger reach a "useful
moment" before their attention runs out?

The spec is graded screenshot-by-screenshot. There is no single
pass/fail. At the end the runner produces a checklist of subjective
findings the operator reviews.

## Preconditions

- Anonymous browser context (`$B stop`).
- Fresh email per run.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+5min-$TT_RUN_ID@example.test"
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-shots"
T0=$(date +%s)
log() { echo "[T+$(($(date +%s)-T0))s] $*" >> "/tmp/$TT_NS-log.txt"; echo "$*"; }
```

## Tests

### T1. Land on / and read for 10 seconds

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/01-landing.png"
log "landing first paint"
text=$($B text)
# Subjective: do these strings convey what the product is?
echo "--- LANDING TEXT (first 1000 chars) ---" >> "/tmp/$TT_NS-log.txt"
echo "$text" | head -c 1000 >> "/tmp/$TT_NS-log.txt"
```

### T2. Find the primary CTA and follow it

```bash
$B click 'a:has-text("Sign up"), a:has-text("Get started"), button:has-text("Sign up")' \
  || { log "BLOCKER: no obvious primary CTA above the fold"; exit 1; }
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/02-after-cta.png"
url=$($B url)
log "CTA destination: $url"
```

### T3. Sign up and reach first authenticated screen

```bash
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B fill 'input[name="name"], input[placeholder*="name" i]' "5MinUser"
$B click 'input[type="checkbox"]'
$B click 'button[type="submit"]:has-text("Sign up"), button:has-text("Create account")'
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/03-post-signup.png"
url=$($B url)
log "post-signup URL: $url"
[[ "$url" != *"/signup"* ]] || { log "BLOCKER: still on /signup after submit"; exit 1; }
```

### T4. The first authenticated screen explains what to do next

```bash
text=$($B text)
echo "--- POST-SIGNUP TEXT (first 1000 chars) ---" >> "/tmp/$TT_NS-log.txt"
echo "$text" | head -c 1000 >> "/tmp/$TT_NS-log.txt"
# Subjective: does the screen tell me what's possible? Look for any of these
# orientation strings:
grep -qiE 'metric|workspace|forecast|prediction|template|kpi' <<<"$text" \
  || log "FRICTION: post-signup screen has no orientation copy"
```

### T5. Do one thing that produces a visible result

```bash
# Try to update one metric value if a template seeded any.
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/04-check-in.png"
$B snapshot -i > "/tmp/$TT_NS-snap.txt"
# Find any number input and bump it
ref=$(grep -oE '@e[0-9]+' "/tmp/$TT_NS-snap.txt" | head -1)
if [ -n "$ref" ]; then
  $B fill "$ref" "999"
  $B press Tab
  $B wait --networkidle
  $B screenshot "/tmp/$TT_NS-shots/05-after-update.png"
  log "first update placed"
else
  log "FRICTION: no input found on /check-in for first update"
fi
```

### T6. Look for forecast / consensus / chart movement

```bash
text=$($B text)
grep -qiE 'consensus|forecast|outlook|prediction' <<<"$text" \
  || log "FRICTION: no forecast indicator visible after first update"
```

### T7. Check elapsed time

```bash
elapsed=$(($(date +%s)-T0))
log "total elapsed: ${elapsed}s"
[ "$elapsed" -le 300 ] || log "OVER BUDGET: ${elapsed}s > 300s"
```

### T8. Print the structured findings file

```bash
echo "--- FINDINGS ---"
cat "/tmp/$TT_NS-log.txt"
echo
echo "Screenshots: /tmp/$TT_NS-shots/"
```

## Cleanup

Auto.

## Known gaps

- This spec does not assert pass/fail on subjective items; it produces a
  log. Use `12-ux/consistency-audit.md` for the visual-consistency take and
  `personas/01-hn-skeptic.md` for the "what would Jordan think" angle.
- Five minutes is one persona's budget; mobile-first visitors get tested in
  `12-ux/mobile-feel.md`.
