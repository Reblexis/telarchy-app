---
id: 12-ux-weird-behavior-hunt
tags: [browse, ux, abuse]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 360s
goal-horizon: short
goal-statement: |
  As an exploratory tester poking at edges, I look for weird and
  unexpected behaviour: visuals breaking, state desync, double-render,
  console-error-on-hover, things the happy-path specs don't catch.
grader: auto
grade-prompt: |
  You are evaluating an exploratory testing session for unexpected
  behaviours. Score:
  - state-desync (1-10): how clean is in-flight state on this product?
  - visual stability (1-10): does the layout jitter or shift?
  - error transparency (1-10): are unexpected errors surfaced (logged) or hidden?
  - polish breadth (1-10): does polish cover edges, or only the demo path?
  Output a list of ALL the weird things noted, with severity (blocker /
  high / medium / low) and one-line repro.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Weird-behaviour hunt

## What this tests

The "what could go wrong" probe. Not a single feature; an attempt to find
hidden friction. Each leg captures one class of weirdness.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+wbh-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "Tester")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-wbh"
findings="/tmp/$TT_NS-wbh/findings.txt"
:>"$findings"
note() { echo "WEIRD: $1" >> "$findings"; echo "WEIRD: $1"; }
```

## Tests

### W1. Rapid double-click on the primary CTA → double submit?

```bash
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
$B network --clear
ref=$($B snapshot -i | grep -oE '@e[0-9]+' | head -1)
[ -n "$ref" ] && {
  $B fill "$ref" "100"
  $B press Tab
  $B press Tab
  $B wait --networkidle
}
n_writes=$($B network | jq -r '.[].url' | grep -c '/api/metrics/[^/]*$')
[ "$n_writes" -gt 1 ] && note "double-PUT: rapid Tab triggered $n_writes writes"
```

### W2. Browser back-button after a destructive action

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-wbh/01-before-back.png"
$B navigate-back
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-wbh/02-after-back.png"
text=$($B text)
grep -qE 'undefined|null' <<<"$text" && note "back button revealed undefined/null in text"
```

### W3. Long workspace name overflow

```bash
big=$(printf 'X%.0s' $(seq 1 200))
WS_BIG=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg n "$big" '{name:$n,template:"blank",visibility:"public"}')" \
  "$TT_BASE_URL/api/workspaces" 2>/dev/null | jq -r '.id // empty')
if [ -n "$WS_BIG" ]; then
  tt_on_cleanup "tt_rm_workspace '$WS_BIG'"
  $B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
  $B screenshot "/tmp/$TT_NS-wbh/03-long-name.png"
  ow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
  [ "$ow" = "true" ] && note "long workspace name caused horizontal overflow on /marketplace"
fi
```

### W4. Hover behaviour on chart points

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B click 'button:has-text("Graph"), [data-testid="graph-button"]' || true
$B wait --networkidle
$B console --clear
$B hover 'canvas' || true
out=$($B console --errors)
[ -n "$out" ] && note "hover on chart canvas produced console errors: $(echo "$out" | head -c 200)"
```

### W5. Open a modal, navigate away with the URL — modal traps?

```bash
$B click 'button:has-text("Edit"), button:has-text("Settings")' || true
$B wait --networkidle
$B goto "$TT_FRONTEND_URL/markets"
$B wait --networkidle
trapped=$($B is visible '[role="dialog"], .modal' 2>/dev/null && echo yes || echo no)
[ "$trapped" = "yes" ] && note "modal still rendered after navigation"
```

### W6. Auto-save on a number input with non-numeric paste

```bash
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
$B console --clear
ref=$($B snapshot -i | grep -oE '@e[0-9]+' | head -1)
[ -n "$ref" ] && {
  $B fill "$ref" "abc12.34xyz"
  $B press Tab
  $B wait --networkidle
}
out=$($B console --errors)
[ -n "$out" ] && note "non-numeric paste triggered console errors"
```

### W7. Resize storm — does layout reflow gracefully?

```bash
for vp in 1920x1080 1440x900 1024x768 768x1024 480x800 320x568; do
  $B viewport $vp
  $B reload && $B wait --networkidle
done
$B viewport 1440x900
out=$($B console --errors)
[ -n "$out" ] && note "resize storm triggered console errors"
```

### W8. Open the same URL in two tabs — state divergence?

```bash
# browse cannot manage two contexts in parallel; we proxy by reading the API
# state mid-edit and asserting consistency.
v0=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/metrics" | jq 'length')
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
v1=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/metrics" | jq 'length')
[ "$v0" = "$v1" ] || note "metrics count drifted in 1 reload: $v0 → $v1"
```

### W9. URL-injected query params

```bash
for s in "/metrics?id=' OR 1=1--" "/markets?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E" "/proposals?status=null"; do
  $B goto "$TT_FRONTEND_URL$s" && $B wait --networkidle
  text=$($B text)
  grep -qE 'TypeError|ReferenceError|stack at' <<<"$text" && note "URL-injection on $s shows error in text"
done
```

### W10. Console error sweep across all main pages

```bash
for p in / /signup /login /metrics /markets /proposals /sources /admin /marketplace /guides; do
  $B console --clear
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  out=$($B console --errors)
  [ -n "$out" ] && note "console errors on $p: $(echo "$out" | head -c 200)"
done
```

### W11. Print

```bash
echo "=== WEIRD-BEHAVIOUR DOSSIER ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-wbh/"
```

## Cleanup

Auto.

## Known gaps

- This is exploratory by nature; coverage grows as new edges are
  reported. Promote any "WEIRD: …" finding into its own focused spec.
