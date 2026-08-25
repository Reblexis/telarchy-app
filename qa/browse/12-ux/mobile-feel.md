---
id: 12-ux-mobile-feel
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a phone-first visitor (iPhone-15 dimensions, 390×844), every page
  is readable, every CTA is tappable without zoom, no horizontal scroll,
  modals don't trap inside themselves, and forms submit without keyboard
  weirdness.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Mobile feel

## What this tests

Layout, tap targets, scroll behaviour, and modal traps at phone dimensions.
Maps to `mvp-evaluation/plan.md` Section 13. The viewport-resize is a
proxy for device feel — physical pinch/zoom and hardware keyboard quirks
remain `(human)` checks.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+mob-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "MobUser")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
$B viewport 390x844
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-mob"
findings="/tmp/$TT_NS-mob/findings.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
```

## Tests

### T1. No horizontal overflow on key pages

```bash
for page in / /signup /login /metrics /markets /proposals /account /sources /marketplace; do
  $B goto "$TT_FRONTEND_URL$page" && $B wait --networkidle
  ow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
  [ "$ow" = "true" ] && note "FRICTION $page: horizontal overflow at 390px"
  $B screenshot "/tmp/$TT_NS-mob/$(echo "$page" | tr / _).png"
done
```

### T2. Tap targets ≥ 40px

```bash
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
small=$($B js '
  const buttons = document.querySelectorAll("button, a, input[type=submit]");
  let small = 0;
  buttons.forEach(b => {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) small++;
  });
  return small;
')
[ "$small" = "0" ] || note "FRICTION /check-in: $small interactive elements < 40px"
```

### T3. Modals don't trap horizontal scroll

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
# Open the first metric's graph modal if available
$B click 'button:has-text("Graph"), button:has-text("Chart"), [data-testid="graph-button"]' || true
$B wait --networkidle
ow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$ow" = "true" ] && note "FRICTION graph modal at 390px overflows"
# Close
$B press Escape
```

### T4. Keyboard does not push fixed footer over inputs

```bash
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
$B click 'input[type="number"], input[inputmode="numeric"]' || true
$B screenshot "/tmp/$TT_NS-mob/check-in-keyboard.png"
# We can't simulate the actual phone keyboard from headless; this is a
# snapshot for human review during a release pass.
```

### T5. Scroll-to-CTA: primary action visible on first paint

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
above_fold=$($B js '
  const cta = document.querySelector("a[href*=signup], button[type=submit]");
  if (!cta) return false;
  const r = cta.getBoundingClientRect();
  return r.top < window.innerHeight;
')
[ "$above_fold" = "true" ] || note "FRICTION /: primary CTA below fold at 390px"
```

### T6. Sidebar collapses on mobile

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
collapsed=$($B js '
  const sb = document.querySelector("aside, [role=navigation]");
  if (!sb) return true;
  const r = sb.getBoundingClientRect();
  return r.width < 200 || r.left < -100 || getComputedStyle(sb).display === "none";
')
[ "$collapsed" = "true" ] || note "FRICTION /metrics@390: sidebar still expanded (will eat content)"
```

### T7. Marketplace card readable at 390px

```bash
$B stop
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
ow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$ow" = "true" ] && note "FRICTION /marketplace@390: overflow"
$B screenshot "/tmp/$TT_NS-mob/marketplace.png"
```

## Findings

```bash
cat "$findings"
echo "Shots: /tmp/$TT_NS-mob/"
```

## Known gaps

- No tablet (768px) coverage; add when iPad-portrait becomes a target.
- No real touch event coverage (CDP touch emulation needed).
