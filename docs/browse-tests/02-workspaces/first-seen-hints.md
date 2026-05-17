---
id: 02-workspaces-first-seen-hints
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  Contextual one-shot hints fire the first time a signed-in user lands
  on a surface that the welcome tour does not cover: the Markets list,
  and the proposal drawer's "Impact predictions" section. Each hint
  dismisses with "Got it", persists in localStorage under its own
  per-key flag, and is suppressed while the welcome tour is active.
---

# Browse test: First-seen contextual hints

## What this tests

`useFirstSeenHint` + `<FirstSeenHint />` together implement
once-per-user contextual coachmarks that complement the welcome tour.
The welcome tour explains "what each tab is for"; first-seen hints
explain "what this section in this tab is doing", and only the first
time the user opens it.

The two current integrations:

- `markets-list` key: fires the first time the user opens the Markets
  tab, pointing at the first market card.
- `proposal-impact` key: fires the first time the user opens the
  proposal drawer (by clicking a proposal row), pointing at the
  "Impact predictions" section.

The invariants we verify:

- Hint fires only when its `telarchy.firstSeen.<key>` flag is unset.
- "Got it" sets the flag and the hint never appears again (even after
  reload or navigating away and back).
- Hints are suppressed entirely while the welcome tour is active, so
  the two overlays never stack.
- The two keys are independent; dismissing one does not dismiss the
  other.

## Preconditions

- Auth: test user `viktor.cihal@gmail.com` / `TestAdmin99!` exists and
  has at least one workspace with at least one proposal in pending or
  any other status (the existing `My Utility` test workspace
  qualifies). No master key required.
- Frontend: dev server on `$TT_FRONTEND_URL` (default
  `http://localhost:5173`).

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900

HINTS_FAILS=0

$B goto "$TT_FRONTEND_URL/login"
$B wait --networkidle
sleep 1
$B fill 'input[type=email]' 'viktor.cihal@gmail.com'
$B fill 'input[type=password]' 'TestAdmin99!'
$B click 'button[type=submit]'
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  URL=$($B url)
  case "$URL" in *"/login"*) sleep 1 ;; *) break ;; esac
done
URL=$($B url)
case "$URL" in
  *"/login"*) echo "Setup FAIL: still at $URL after login"; exit 1 ;;
esac

# Pretend the welcome tour has already been seen, so the first-seen
# hints are the only overlay we are exercising. Clear both per-key
# flags so the hints fire fresh.
$B js "localStorage.setItem('telarchy.tour.seen.v2','1'); localStorage.removeItem('telarchy.firstSeen.markets-list'); localStorage.removeItem('telarchy.firstSeen.proposal-impact'); 'ok'" >/dev/null
```

## Tests

### T1. Markets hint fires on first visit and points at the first market card

```bash
$B goto "$TT_FRONTEND_URL/markets"
$B wait --networkidle
sleep 2

if [ "$($B is visible '.first-seen-hint')" = "true" ]; then
  echo "T1 PASS: Markets first-seen hint visible"
  $B screenshot "/tmp/$TT_NS-hint-markets.png" >/dev/null
else
  echo "T1 FAIL: Markets first-seen hint not visible"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

# The hint card carries data-tour-id="first-seen-markets-list".
if [ "$($B is visible '[data-tour-id="first-seen-markets-list"]')" = "true" ]; then
  echo "T1 PASS: hint uses the markets-list key"
else
  echo "T1 FAIL: hint with key markets-list not found"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

# The first market card carries the glow class while the hint is open.
GLOW=$($B js "document.querySelectorAll('.first-seen-target-glow').length")
[ "$GLOW" -ge 1 ] && echo "T1 PASS: market card has glow ($GLOW)" \
  || { echo "T1 FAIL: no .first-seen-target-glow visible"; HINTS_FAILS=$((HINTS_FAILS+1)); }
```

### T2. "Got it" dismisses, persists across reload, and never re-appears

```bash
$B click '.first-seen-dismiss' >/dev/null
sleep 1

if [ "$($B is hidden '.first-seen-hint')" = "true" ]; then
  echo "T2 PASS: hint hidden after Got it"
else
  echo "T2 FAIL: hint still visible after Got it"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

FLAG=$($B js "localStorage.getItem('telarchy.firstSeen.markets-list')")
tt_assert_contains "1" "$FLAG" "T2 markets-list flag set" || HINTS_FAILS=$((HINTS_FAILS+1))

$B reload
$B wait --networkidle
sleep 2

if [ "$($B is hidden '.first-seen-hint')" = "true" ]; then
  echo "T2 PASS: hint stays hidden after reload"
else
  echo "T2 FAIL: hint reappeared after reload"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi
```

### T3. Proposal-impact hint is independent of Markets hint

The Markets hint flag is set; the proposal-impact flag should still be
unset, so the hint should fire when we open a proposal drawer.

```bash
$B goto "$TT_FRONTEND_URL/proposals"
$B wait --networkidle
sleep 1

# Click the first proposal row. data-tour-id is set only on the first row.
$B click '[data-tour-id="proposals-first-row"]'
sleep 2

if [ "$($B is visible '.first-seen-hint')" = "true" ]; then
  echo "T3 PASS: proposal-impact hint visible (independent of markets-list)"
  $B screenshot "/tmp/$TT_NS-hint-proposal.png" >/dev/null
else
  echo "T3 FAIL: proposal-impact hint not visible after opening drawer"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

if [ "$($B is visible '[data-tour-id="first-seen-proposal-impact"]')" = "true" ]; then
  echo "T3 PASS: hint uses the proposal-impact key"
else
  echo "T3 FAIL: hint with key proposal-impact not found"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

$B click '.first-seen-dismiss' >/dev/null
sleep 1
FLAG=$($B js "localStorage.getItem('telarchy.firstSeen.proposal-impact')")
tt_assert_contains "1" "$FLAG" "T3 proposal-impact flag set on dismiss" || HINTS_FAILS=$((HINTS_FAILS+1))
```

### T4. Hints are suppressed while the welcome tour is active

Activate the welcome tour by clearing its flag, then revisit Markets
with the markets-list hint flag also cleared. The tour modal must show
and the first-seen hint must NOT show.

```bash
$B js "localStorage.removeItem('telarchy.tour.seen.v2'); localStorage.removeItem('telarchy.firstSeen.markets-list'); 'reset'" >/dev/null
$B goto "$TT_FRONTEND_URL/markets"
$B wait --networkidle
sleep 2

TOUR_VIS=$($B is visible '.tour-modal')
HINT_VIS=$($B is visible '.first-seen-hint')
if [ "$TOUR_VIS" = "true" ] && [ "$HINT_VIS" = "false" ]; then
  echo "T4 PASS: tour visible, hint suppressed"
else
  echo "T4 FAIL: tour=$TOUR_VIS hint=$HINT_VIS (expected true/false)"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi

# Skip the tour for the next test.
$B click '.tour-btn-ghost' >/dev/null
sleep 1
```

### T5. Hint resumes firing once the tour is closed (and flag was cleared)

After skipping the tour above, the welcome tour flag is now set (Skip
persists it) so the tour is inactive. The Markets hint flag was also
cleared in T4 setup. Reloading the Markets tab should now show the
hint (the suppression only applies while the tour was active).

```bash
$B reload
$B wait --networkidle
sleep 2

if [ "$($B is visible '.first-seen-hint')" = "true" ]; then
  echo "T5 PASS: hint reappears once tour is no longer active"
else
  echo "T5 FAIL: hint did not reappear after tour was skipped"
  HINTS_FAILS=$((HINTS_FAILS+1))
fi
```

## Exit

```bash
if [ "${HINTS_FAILS:-0}" -gt 0 ]; then
  echo "first-seen-hints spec: $HINTS_FAILS check(s) failed"
  exit 1
fi
echo "first-seen-hints spec: all checks passed"
```

## Cleanup

```bash
# Reset both hint flags so subsequent specs (and humans using this
# account) get the default first-time experience back.
$B js "localStorage.removeItem('telarchy.firstSeen.markets-list'); localStorage.removeItem('telarchy.firstSeen.proposal-impact'); 'cleaned'" >/dev/null
```

## Known gaps

- Only tests the two integrations live today (`markets-list`,
  `proposal-impact`). When new integrations are added, this spec
  should grow a per-key test.
- Does not verify hint positioning (right/below/above/dock). Manually
  inspected at commit time.
- Does not verify the `createPortal` escape from the proposal drawer's
  `transform: translateX` ancestor; the integration test fact that
  the hint is visible at all proves the portal works.
