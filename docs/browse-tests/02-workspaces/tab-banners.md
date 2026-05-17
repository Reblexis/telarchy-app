---
id: 02-workspaces-tab-banners
tags: [browse, fast]
isolation: user
parallel-safe: false
needs: [auth, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  Per-tab opt-in banners fire the first time a user lands on each tab
  that has a deep-dive tutorial. "No thanks" persistently dismisses
  the banner for that tab. "Take tour" launches the matching tab
  tutorial. Banners are suppressed while a persona tutorial is
  active. AI Agent and Trader persona-tutorial stubs also reachable
  from the Tutorials hub.
---

# Browse test: Tab opt-in banners + Trader/AI Agent tutorials

## What this tests

Phase 2 + 3 additions to the tutorial system:

1. **Tab opt-in banners** fire on first visit to every tab that has a
   deep-dive tutorial (Metrics, Markets, Proposals, Sources,
   Marketplace, Leaderboard, Participants).
2. **Two-button banner UX**: "Take tour" launches the tab tutorial
   and sets the flag; "No thanks" sets the flag without launching.
   Either way, the banner does not re-appear.
3. **Suppression while persona tutorial active**: if the user is
   mid-Builder-tutorial, the tab banner is hidden so overlays do
   not stack.
4. **Trader and AI Agent persona tutorials** start from the
   Tutorials hub via Replay/Take buttons. Each fires its welcome
   modal correctly.
5. **Tutorials hub** lists all 10 tutorials (3 persona + 7 tab)
   with status labels.

## Preconditions

- Auth: test user `viktor.cihal@gmail.com` / `TestAdmin99!` with at
  least one workspace owned. No master key required.
- Frontend: `$TT_FRONTEND_URL`.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900

TAB_FAILS=0

$B goto "$TT_FRONTEND_URL/login"
$B wait --networkidle
sleep 1
$B fill 'input[type=email]' 'viktor.cihal@gmail.com'
$B fill 'input[type=password]' 'TestAdmin99!'
$B click 'button[type=submit]'
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  case "$($B url)" in *"/login"*) sleep 1 ;; *) break ;; esac
done
case "$($B url)" in
  *"/login"*) echo "Setup FAIL: still at /login"; exit 1 ;;
esac

# Mark Builder completed and persona set so the persona picker
# does NOT fire. Clear every tab banner flag so banners fire fresh.
$B js "localStorage.setItem('telarchy.tutorial.persona.v3','builder'); localStorage.setItem('telarchy.tutorial.completed.v3', JSON.stringify(['builder'])); localStorage.removeItem('telarchy.tutorial.active.v3'); localStorage.setItem('telarchy.tutorial.step.v3','0'); Object.keys(localStorage).filter(k => k.startsWith('telarchy.tutorial.tabBanner.')).forEach(k=>localStorage.removeItem(k)); 'ready'" >/dev/null
```

## Tests

### T1. Banner fires on each tab's first visit

```bash
declare -A EXPECT
EXPECT[/metrics]="Metrics tab"
EXPECT[/markets]="Markets tab"
EXPECT[/proposals]="Proposals tab"
EXPECT[/sources]="Sources tab"
EXPECT[/marketplace]="Marketplace"
EXPECT[/leaderboard]="Leaderboard"
EXPECT[/participants]="Participants tab"

for path in /metrics /markets /proposals /sources /marketplace /leaderboard /participants; do
  $B goto "$TT_FRONTEND_URL$path"
  $B wait --networkidle
  sleep 2
  vis=$($B is visible '.tab-tour-banner')
  if [ "$vis" = "true" ]; then
    text=$($B js "document.querySelector('.tab-tour-banner-text')?.textContent || ''")
    case "$text" in
      *"${EXPECT[$path]}"*) echo "T1 PASS: banner fired on $path with expected copy" ;;
      *) echo "T1 FAIL: banner on $path has unexpected text: '$text' (expected to contain '${EXPECT[$path]}')"; TAB_FAILS=$((TAB_FAILS+1)) ;;
    esac
  else
    echo "T1 FAIL: banner not visible on $path"
    TAB_FAILS=$((TAB_FAILS+1))
  fi
done
```

### T2. "No thanks" persistently dismisses the banner

```bash
# Clear flags so banners re-fire.
$B js "Object.keys(localStorage).filter(k => k.startsWith('telarchy.tutorial.tabBanner.')).forEach(k=>localStorage.removeItem(k)); 'cleared'" >/dev/null

$B goto "$TT_FRONTEND_URL/proposals"
$B wait --networkidle
sleep 2
vis=$($B is visible '.tab-tour-banner')
tt_assert_eq "true" "$vis" "T2 banner visible on /proposals (fresh)" || TAB_FAILS=$((TAB_FAILS+1))

# Click No thanks
$B click '.tab-tour-banner-btn-ghost'
sleep 1
vis=$($B is visible '.tab-tour-banner')
tt_assert_eq "false" "$vis" "T2 banner hidden after No thanks" || TAB_FAILS=$((TAB_FAILS+1))

# Reload: still hidden
$B reload
$B wait --networkidle
sleep 1
vis=$($B is visible '.tab-tour-banner')
tt_assert_eq "false" "$vis" "T2 banner stays hidden after reload" || TAB_FAILS=$((TAB_FAILS+1))

# Flag was written
flag=$($B js "localStorage.getItem('telarchy.tutorial.tabBanner.tab-proposals') || ''")
tt_assert_contains "1" "$flag" "T2 tab-proposals flag set on dismiss" || TAB_FAILS=$((TAB_FAILS+1))
```

### T3. "Take tour" launches the matching tab mini-tutorial

```bash
# Clear flag for /sources, navigate, take tour.
$B js "localStorage.removeItem('telarchy.tutorial.tabBanner.tab-sources'); localStorage.removeItem('telarchy.tutorial.active.v3'); localStorage.setItem('telarchy.tutorial.step.v3','0'); 'cleared'" >/dev/null
$B goto "$TT_FRONTEND_URL/sources"
$B wait --networkidle
sleep 2
$B click '.tab-tour-banner-btn-primary'
sleep 2

# A coachmark from the tab-sources tutorial should now be visible.
vis_coach=$($B is visible '.tour-coach')
tt_assert_eq "true" "$vis_coach" "T3 tab-sources tutorial coachmark visible" || TAB_FAILS=$((TAB_FAILS+1))

# Title should mention "Add a source".
title=$($B js "document.querySelector('.tour-coach-title')?.textContent || ''")
tt_assert_contains "Add a source" "$title" "T3 first coach step has expected title" || TAB_FAILS=$((TAB_FAILS+1))

# Skip the tutorial so we are clean for the next test.
$B js "Array.from(document.querySelectorAll('button.tour-btn-ghost')).find(b => /Skip tutorial/.test(b.textContent || ''))?.click(); 'skipped'" >/dev/null
sleep 1
```

### T4. Banner suppressed while a persona tutorial is active

```bash
# Activate the Builder tutorial mid-stream and clear the metrics
# banner flag. The banner should NOT show, only the tutorial overlay.
$B js "localStorage.setItem('telarchy.tutorial.active.v3','builder'); localStorage.setItem('telarchy.tutorial.step.v3','2'); localStorage.removeItem('telarchy.tutorial.tabBanner.tab-metrics'); 'set'" >/dev/null
$B goto "$TT_FRONTEND_URL/metrics"
$B wait --networkidle
sleep 2
vis_banner=$($B is visible '.tab-tour-banner')
vis_overlay=$($B is visible '.tour-coach, .tour-modal')
tt_assert_eq "false" "$vis_banner" "T4 banner suppressed while tutorial active" || TAB_FAILS=$((TAB_FAILS+1))
tt_assert_eq "true" "$vis_overlay" "T4 tutorial overlay visible" || TAB_FAILS=$((TAB_FAILS+1))

# Skip the Builder tutorial.
$B js "Array.from(document.querySelectorAll('button.tour-btn-ghost')).find(b => /Skip tutorial/.test(b.textContent || ''))?.click(); 'skipped'" >/dev/null
sleep 1
```

### T5. Trader persona tutorial reachable from inside the Guides tab

```bash
$B goto "$TT_FRONTEND_URL/guides"
$B wait --networkidle
sleep 1
$B click '[data-tour-id="guides-nav-tutorials"]' >/dev/null
sleep 1
# Find the "Forecast and trade" card and click its primary button.
took=$($B js "(() => {
  const cards = document.querySelectorAll('.tutorial-card');
  for (const c of cards) {
    if (/Forecast and trade/i.test(c.textContent || '')) {
      const btn = c.querySelector('.tour-btn-primary');
      if (btn) { btn.click(); return 'clicked'; }
    }
  }
  return 'NOT_FOUND';
})()")
tt_assert_contains "clicked" "$took" "T5 clicked Take/Resume on Trader card" || TAB_FAILS=$((TAB_FAILS+1))
sleep 2
# Trader welcome modal title contains "Find a market".
trader_title=$($B js "document.querySelector('.tour-modal h2')?.textContent || ''")
tt_assert_contains "Find a market" "$trader_title" "T5 Trader welcome modal visible" || TAB_FAILS=$((TAB_FAILS+1))

# Skip.
$B js "Array.from(document.querySelectorAll('button.tour-btn-ghost')).find(b => /Skip/.test(b.textContent || ''))?.click(); 'skipped'" >/dev/null
sleep 1
```

### T6. AI Agent persona tutorial reachable from inside the Guides tab

```bash
$B goto "$TT_FRONTEND_URL/guides"
$B wait --networkidle
sleep 1
$B click '[data-tour-id="guides-nav-tutorials"]' >/dev/null
sleep 1
took=$($B js "(() => {
  const cards = document.querySelectorAll('.tutorial-card');
  for (const c of cards) {
    if (/Plug an AI agent in|Build or integrate an AI participant/i.test(c.textContent || '')) {
      const btn = c.querySelector('.tour-btn-primary');
      if (btn) { btn.click(); return 'clicked'; }
    }
  }
  return 'NOT_FOUND';
})()")
tt_assert_contains "clicked" "$took" "T6 clicked Take/Resume on AI Agent card" || TAB_FAILS=$((TAB_FAILS+1))
sleep 2
agent_title=$($B js "document.querySelector('.tour-modal h2')?.textContent || ''")
tt_assert_contains "AI agent" "$agent_title" "T6 AI Agent welcome modal visible" || TAB_FAILS=$((TAB_FAILS+1))

$B js "Array.from(document.querySelectorAll('button.tour-btn-ghost')).find(b => /Skip/.test(b.textContent || ''))?.click(); 'skipped'" >/dev/null
sleep 1
```

### T7. Guides Tutorials launcher lists all 10 tutorials (3 persona + 7 tab)

```bash
$B goto "$TT_FRONTEND_URL/guides"
$B wait --networkidle
sleep 1
$B click '[data-tour-id="guides-nav-tutorials"]' >/dev/null
sleep 1
N=$($B js "document.querySelectorAll('.tutorial-card').length")
tt_assert_eq "10" "$N" "T7 launcher lists 10 tutorial cards" || TAB_FAILS=$((TAB_FAILS+1))
```

## Exit

```bash
if [ "${TAB_FAILS:-0}" -gt 0 ]; then
  echo "tab-banners spec: $TAB_FAILS check(s) failed"
  exit 1
fi
echo "tab-banners spec: all checks passed"
```

## Cleanup

```bash
# Reset all the tutorial state so the test user gets the default
# experience back.
$B js "['telarchy.tutorial.active.v3','telarchy.tutorial.step.v3'].forEach(k=>localStorage.removeItem(k)); Object.keys(localStorage).filter(k => k.startsWith('telarchy.tutorial.tabBanner.')).forEach(k=>localStorage.removeItem(k)); 'cleaned'" >/dev/null
```

## Known gaps

- Trader/AI Agent action-driven polling (join workspace, place trade,
  mint API key) is exercised only at the welcome modal level here;
  the full action-driven paths are validated manually because they
  require destructive backend changes (joining/leaving workspaces,
  minting/revoking keys) that we do not want to ride on viktor's
  test account in CI.
- Does not test that opening a tab tutorial sets its
  `telarchy.tutorial.tabBanner.<id>` flag so the banner stays gone
  after the tutorial completes (covered by the live verification
  on commit but not in this spec).
- No coverage of the banner CSS in dark mode (manual screenshot
  only).
