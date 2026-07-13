---
id: 12-ux-welcome-canvas
tags: [browse, auth, slow]
isolation: fresh-account
parallel-safe: false
needs: [browse]
timeout: 180s
goal-horizon: medium
goal-statement: |
  As a brand-new browser user I run the cinematic first-run canvas end to end
  in a few taps, with near-zero reading, and land in a real, populated
  workspace. Traders and agent-builders are routed away from it.
---

# Browse test: Welcome canvas (/welcome)

## What this tests

The cinematic first-run canvas (`src/pages/WelcomePage.tsx`). Brand-new
browser signups land on `/welcome`, not the persona-picker + coach-tour.
Five beats: intent, template, name (creates the workspace), calibrate (live
gauges), loop (concept slider + reveal), then into the real workspace.

## Preconditions

- `$TT_FRONTEND_URL` reachable, backend up, signups working from this origin.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
```

## Tests

### T1. Signup routes to /welcome (not /create-workspace)

```bash
EMAIL="welcome-canvas-$RANDOM@example.com"
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B snapshot -i >/dev/null
$B fill "input#email" "$EMAIL"
$B fill "input#displayName" "Canvas Spec"
$B fill "input#password" "CanvasSpec-2026!x"
$B click "button:has-text('Create account')"
sleep 3 && $B wait --networkidle
case "$($B url)" in *"/welcome"*) ;; *) echo "FAIL: not on /welcome"; exit 1;; esac
```

### T2. Intent beat: three tracks; trade/agent route away

```bash
$B text | grep -qi "what brings you here"
# The creator track stays on the canvas:
$B click "text=Improve my decisions" && sleep 1
$B text | grep -qi "what matters to you"
```

### T3. Template -> name -> create (SaaS needs inline currency/scale)

```bash
$B click "text=SaaS startup" && sleep 1
$B text | grep -qi "MRR target"           # inline config revealed
$B click "button:has-text('Continue')" && sleep 1
$B snapshot -i >/dev/null
$B fill "input[placeholder*='Moonshot']" "Canvas Spec Co"
$B click "button:has-text('Create workspace')"
sleep 7 && $B wait --load
$B text | grep -qi "where are you now"     # calibrate beat, workspace created
```

### T4. Calibrate a value; gauge reacts; continue to the loop beat

```bash
$B snapshot -i >/dev/null
# Fill the first metric input and blur to auto-save.
$B js "const i=document.querySelectorAll('.wc-metric-input')[0]; const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value').set; s.call(i,'340'); i.dispatchEvent(new Event('input',{bubbles:true})); i.blur(); 'ok'"
sleep 1
$B click "button:has-text('Continue')" && sleep 1
$B text | grep -qi "priced against this"   # loop beat
```

### T5. Loop slider reveal, then into the real workspace

```bash
$B js "const s=document.querySelector('.wc-slider'); const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s),'value').set; set.call(s, String(Math.round(s.max*0.7))); s.dispatchEvent(new Event('input',{bubbles:true})); 'ok'"
sleep 1
$B text | grep -qi "that is a forecast"    # reveal appears after drag
$B click "button:has-text('Enter your workspace')"
sleep 6 && $B wait --load
case "$($B url)" in *"/metrics"*) ;; *) echo "FAIL: did not hand off to workspace"; exit 1;; esac
# No stray persona picker over the workspace.
$B text | grep -qi "what do you want to do here" && { echo "FAIL: persona picker fired"; exit 1; } || true
```

## Cleanup

Delete the workspace created above via `DELETE /api/workspaces/:id` (the
account is a throwaway; leaving it is harmless on a test instance).

## Known gaps

- Does not exercise the personal (no-config, one-tap) or blank
  (skip-to-workspace) template branches; both are covered manually.
- Slider drag is simulated via the native value setter, not a real pointer
  drag.
