---
id: 00-anonymous-landing
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a stranger arriving at telarchy.com root for the first time, I can
  read what this is in under 10 seconds, see real numbers that signal it's
  a live product, and find one obvious next step (sign up or look at the
  marketplace).
---

# Browse test: Landing page

## What this tests

The landing page is the front door. This spec checks that it loads fast,
renders cleanly across viewports, has working internal links, populates real
counts (not lorem ipsum), and surfaces a primary CTA above the fold.

Maps to `mvp-evaluation/plan.md` Section 1.

## Preconditions

- `$TT_FRONTEND_URL` reachable (defaults to local Vite).
- Public stats endpoint live: `curl -s "$TT_BASE_URL/api/marketplace/stats"`
  returns counts, not 5xx.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop  # cold-start, no cookies
$B goto "$TT_FRONTEND_URL/"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-landing-baseline.png"
```

## Tests

### T1. Hero copy answers "what is this?"

```bash
$B text > "/tmp/$TT_NS-landing.txt"
grep -qi "telarchy\|prediction\|forecast\|alignment" "/tmp/$TT_NS-landing.txt"
```

The page must mention what the product *is*. The exact copy can drift.

### T2. Primary CTA visible above the fold

```bash
$B viewport 1440x900
$B reload && $B wait --networkidle
$B is visible 'a[href*="/signup"], a[href*="/marketplace"], button:has-text("Sign up"), button:has-text("Get started")'
```

### T2b. Hero has "Get started" + a compact "Copy agent prompt" pill

The hero is agentphone.ai-style (2026-07-13): a primary "Get started" beside a
compact "Copy agent prompt" pill. The prompt itself is HIDDEN behind the pill
(copied to clipboard on click), not rendered as text on the page.

```bash
$B is visible 'a:has-text("Get started")'
$B is visible 'button:has-text("Copy agent prompt")'
# The prompt copies the onboarding-guide setup sentence; that guide must be live:
curl -sf "$TT_BASE_URL/api/guides/onboarding" | grep -qi "agent onboarding"
```

### T3. No console errors on first paint

```bash
$B console --clear
$B reload && $B wait --networkidle
# $B wraps output in BEGIN/END UNTRUSTED EXTERNAL CONTENT markers — strip them.
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

### T4. No 4xx/5xx network responses on first paint

```bash
$B network | jq -r '.[] | select(.status >= 400) | "\(.status) \(.url)"' \
  | grep -v 'favicon\|hot-update' | grep . && exit 1 || true
```

### T5. Footer links resolve

```bash
for href in /terms /privacy /marketplace /signup /login; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_FRONTEND_URL$href")
  [ "$status" = "200" ] || { echo "FAIL $href -> $status"; exit 1; }
done
```

### T6. Mobile viewport (375 × 812) has no horizontal overflow

```bash
$B viewport 375x812
$B reload && $B wait --networkidle
overflow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$overflow" = "false" ]
$B screenshot "/tmp/$TT_NS-landing-mobile.png"
```

### T7. Tablet viewport (768 × 1024) renders cleanly

```bash
$B viewport 768x1024
$B reload && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-landing-tablet.png"
```

### T8. OG and Twitter card meta tags populated

```bash
html=$(curl -sf "$TT_FRONTEND_URL/")
for tag in og:title og:description og:image twitter:card; do
  grep -q "property=\"$tag\"\|name=\"$tag\"" <<<"$html" \
    || { echo "missing meta $tag"; exit 1; }
done
```

## Cleanup

None — this spec only reads.

## Known gaps

- No Lighthouse / Core Web Vitals assertion. Add via `$B perf` once a budget
  is locked in.
- No assertion on alt text for hero imagery (accessibility).
