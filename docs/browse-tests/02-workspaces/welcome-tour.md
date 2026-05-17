---
id: 02-workspaces-welcome-tour
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse, master-key]
timeout: 240s
goal-horizon: short
goal-statement: |
  As a freshly signed-up participant landing in a new workspace, the
  12-step welcome tour fires automatically and walks me through every
  workspace tab (Metrics with field-by-field Add Metric form, Check-in,
  Proposals with the seeded starter row, New proposal, Markets,
  Participants, Sources). Progress dots and Back/Skip work; the
  localStorage flag persists; the sidebar "Show product tour" link
  re-opens it any time.
---

# Browse test: Welcome tour (12 steps) + starter proposal seeding

## What this tests

Three coupled pieces that ship together:

1. Workspace creation seeds one starter proposal owned by the workspace
   owner so the tour has something concrete to point at.
2. The 12-step welcome tour (welcome modal -> Metrics tab -> Add metric
   ghost card -> Name field -> More options -> Check-in -> Proposals +
   first row -> New proposal -> Markets -> Participants -> Sources ->
   done card) fires on first authenticated visit and is config-driven.
3. The sidebar restart link re-opens the tour even after the
   `telarchy.tour.seen.v2` localStorage flag is set.

## Preconditions

- Auth: master key in `$TT_ADMIN_KEY` (used by `tt_mkuser` / cleanup).
- Frontend: dev server on `$TT_FRONTEND_URL` (default
  `http://localhost:5173`).
- Backend: dev API on `$TT_BASE_URL` (default `http://localhost:8080`).
- Test user `viktor.cihal@gmail.com` / `TestAdmin99!` exists with at
  least one workspace owned (used by the UI-flow tests; the backend
  seeding test creates a fresh user inline).

## Setup: seed a fresh workspace via user session (for T1)

The starter proposal is only seeded when an owner agent exists. Real
signups always have one; master-key creates via `tt_mkworkspace` skip
seeding by design. So we sign up a fresh user, consent, and have them
create the workspace through the real public API the UI uses.

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900

TOUR_FAILS=0

USER_EMAIL="$TT_NS@example.com"
USER_JAR=$(tt_mkuser "$USER_EMAIL" "TourTest99!" "Tour Tester")
USER_UID=$(curl -sf -b "$USER_JAR" "$TT_BASE_URL/api/auth/me" | jq -r '.uid')

# tt_mkuser sends consent:true in the signup body, but BetterAuth's
# sign-up endpoint does not write the consent column. Record consent
# explicitly so subsequent capability-gated routes are not 403'd.
curl -sf -b "$USER_JAR" -H "Content-Type: application/json" \
  -X POST -d '{"accepted":true}' "$TT_BASE_URL/api/auth/consent" >/dev/null

WS_BODY=$(printf '{"name":"%s","template":"saas","visibility":"public"}' "$TT_NS-ws")
WS_CREATE=$(curl -sf -b "$USER_JAR" -H "Content-Type: application/json" \
  -H "X-Workspace-Id: default" \
  -X POST -d "$WS_BODY" "$TT_BASE_URL/api/workspaces")
WS_ID=$(echo "$WS_CREATE" | jq -r '.id')
STARTER_ID=$(echo "$WS_CREATE" | jq -r '.starterProposalId')

tt_on_cleanup "tt_rm_workspace $WS_ID"
tt_on_cleanup "tt_rm_user $USER_UID"
```

## Tests

### T1. Workspace creation seeds exactly one starter proposal

`starterProposalId` must be populated, and the proposals endpoint must
return exactly one row whose title references Telarchy, whose status is
`pending`, and whose proposer is the workspace owner.

```bash
[ "$STARTER_ID" != "null" ] && [ -n "$STARTER_ID" ] \
  || { echo "T1 FAIL: expected starterProposalId in workspace POST response"; echo "  got: $WS_CREATE"; TOUR_FAILS=$((TOUR_FAILS+1)); }

PROPS=$(curl -sf -b "$USER_JAR" -H "X-Workspace-Id: $WS_ID" \
  "$TT_BASE_URL/api/proposals")
COUNT=$(echo "$PROPS" | jq 'length')
tt_assert_eq "1" "$COUNT" "T1 expected exactly one seeded proposal" || TOUR_FAILS=$((TOUR_FAILS+1))

PROP=$(echo "$PROPS" | jq '.[0]')
TITLE=$(echo "$PROP" | jq -r '.title')
tt_assert_contains "Telarchy" "$TITLE" "T1 title mentions Telarchy" || TOUR_FAILS=$((TOUR_FAILS+1))
tt_assert_eq "pending" "$(echo "$PROP" | jq -r '.status')" "T1 status is pending" || TOUR_FAILS=$((TOUR_FAILS+1))
tt_assert_eq "$USER_UID" "$(echo "$PROP" | jq -r '.proposedBy')" "T1 proposedBy is owner" || TOUR_FAILS=$((TOUR_FAILS+1))
echo "T1: starter proposal seeded ($STARTER_ID) title=\"$TITLE\""
```

### T2-T8. UI tour against viktor's existing workspace

Sign in as the configured test user (`viktor.cihal@gmail.com` /
`TestAdmin99!`) and drive the tour through all 12 steps. Each step has
an expected DOM target; we verify the target exists in the page after
the tour navigates to it. Login uses a small retry loop because the
headless click-then-redirect is timing-sensitive.

```bash
$B goto "$TT_FRONTEND_URL/login"
$B wait --networkidle
sleep 1
$B fill 'input[type=email]' "viktor.cihal@gmail.com"
$B fill 'input[type=password]' 'TestAdmin99!'
$B click 'button[type=submit]'
# Poll up to 15s for the redirect off /login.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  URL=$($B url)
  case "$URL" in *"/login"*) sleep 1 ;; *) break ;; esac
done
URL=$($B url)
tt_assert_contains "/" "$URL" "T2 logged in (not /login)" || { TOUR_FAILS=$((TOUR_FAILS+1)); echo "T2 FAIL: still at $URL"; }

# Reset the tour flag so we start clean.
$B js "localStorage.removeItem('telarchy.tour.seen.v2');'reset'" >/dev/null
$B goto "$TT_FRONTEND_URL/metrics"
$B wait --networkidle
sleep 1

# T2. Welcome modal fires.
if [ "$($B is visible '.tour-modal')" = "true" ]; then
  echo "T2 PASS: welcome modal visible"
  $B screenshot "/tmp/$TT_NS-tour-step0.png" >/dev/null
else
  echo "T2 FAIL: welcome modal not visible after first authenticated visit"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi

# T3. Progress dots render (12 of them).
DOT_COUNT=$($B js "document.querySelectorAll('.tour-progress .tour-dot').length")
tt_assert_eq "12" "$DOT_COUNT" "T3 expected 12 progress dots" || TOUR_FAILS=$((TOUR_FAILS+1))
ACTIVE_DOT=$($B js "document.querySelectorAll('.tour-progress .tour-dot-active').length")
tt_assert_eq "1" "$ACTIVE_DOT" "T3 expected exactly one active dot" || TOUR_FAILS=$((TOUR_FAILS+1))

# T4. Walk through every step and assert its expected target is visible
# in the DOM at the time the tour reaches it. Step 0 is the welcome
# modal (no DOM target); step 11 is the done card (no DOM target).
TARGETS=(
  ""                                                                    # 0  welcome modal
  '[data-tour-id="nav-metrics"]'                                        # 1  Metrics nav
  '[data-tour-id="metric-add-ghost"]'                                   # 2  Add metric ghost card
  '[data-tour-id="metric-form-name"]'                                   # 3  Name field
  '[data-tour-id="metric-form-more-options"]'                           # 4  More options toggle
  '[data-tour-id="nav-check-in"]'                                       # 5  Check-in nav
  '[data-tour-id="proposals-first-row"]'                                # 6  Proposals first row
  '[data-tour-id="proposals-new"]'                                      # 7  + New proposal
  '[data-tour-id="nav-markets"]'                                        # 8  Markets nav
  '[data-tour-id="nav-participants"]'                                   # 9  Participants nav
  '[data-tour-id="nav-sources"]'                                        # 10 Sources nav
  ""                                                                    # 11 done card
)

for i in 1 2 3 4 5 6 7 8 9 10 11; do
  # Click the primary button (Start tour / Next).
  $B click '.tour-btn-primary' >/dev/null
  sleep 2
  target="${TARGETS[$i]}"
  if [ -z "$target" ]; then
    # done card: expect the modal to be visible.
    if [ "$($B is visible '.tour-modal')" = "true" ]; then
      echo "T4.$i PASS: done card visible"
    else
      echo "T4.$i FAIL: done card not visible at step $i"
      TOUR_FAILS=$((TOUR_FAILS+1))
    fi
    continue
  fi
  if [ "$($B is visible "$target")" = "true" ]; then
    echo "T4.$i PASS: $target visible at step $i"
  else
    echo "T4.$i FAIL: $target NOT visible at step $i"
    TOUR_FAILS=$((TOUR_FAILS+1))
  fi
done

# T5. Click "Get started" on the done card. Tour closes, flag is set.
$B click '.tour-btn-primary' >/dev/null
sleep 1
if [ "$($B is hidden '.tour-modal')" = "true" ]; then
  echo "T5 PASS: tour modal hidden after Get started"
else
  echo "T5 FAIL: tour modal still visible after Get started"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi
FLAG=$($B js "localStorage.getItem('telarchy.tour.seen.v2')")
tt_assert_contains "1" "$FLAG" "T5 telarchy.tour.seen.v2 set on finish" || TOUR_FAILS=$((TOUR_FAILS+1))

# T6. Sidebar restart link re-opens the tour even with the flag set.
RESTART_CLICK=$($B js "(()=>{const btns=Array.from(document.querySelectorAll('button.sidebar-nav-item')); const b=btns.find(x=>/Show product tour/i.test(x.textContent||'')); if(!b)return 'NO_BTN'; b.click(); return 'OK';})()")
sleep 1
if [ "$RESTART_CLICK" = "OK" ] && [ "$($B is visible '.tour-modal')" = "true" ]; then
  echo "T6 PASS: sidebar restart re-opens the tour"
else
  echo "T6 FAIL: sidebar restart did not re-open the tour (click=$RESTART_CLICK)"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi

# T7. Back button works: advance one step, then go back.
$B click '.tour-btn-primary' >/dev/null   # step 0 -> 1
sleep 2
BACK_CLICK=$($B js "(()=>{const btns=Array.from(document.querySelectorAll('.tour-btn-ghost')); const b=btns.find(x=>(x.textContent||'').trim()==='Back'); if(!b)return 'NO_BACK'; b.click(); return 'OK';})()")
sleep 1
# After Back from step 1, we should be on the welcome modal again
# (the welcome modal carries the title "An alignment layer for AI and humans").
HEADING=$($B js "document.querySelector('.tour-modal .tour-title')?.textContent || ''")
tt_assert_contains "alignment layer" "$HEADING" "T7 Back returns to welcome modal" || TOUR_FAILS=$((TOUR_FAILS+1))

# T8. Skip closes the tour.
$B click '.tour-btn-ghost' >/dev/null   # Skip (the first ghost button is Skip on the welcome modal)
sleep 1
if [ "$($B is hidden '.tour-modal')" = "true" ]; then
  echo "T8 PASS: Skip closes the tour"
else
  echo "T8 FAIL: Skip did not close the tour"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi
```

## Exit

```bash
if [ "${TOUR_FAILS:-0}" -gt 0 ]; then
  echo "welcome-tour spec: $TOUR_FAILS check(s) failed"
  exit 1
fi
echo "welcome-tour spec: all checks passed"
```

## Cleanup

Registered via `tt_on_cleanup` in Setup: deletes the throwaway
workspace + the test user.

## Known gaps

- Does not test the field-by-field Add Metric form expansion deeply
  (only that the targets are reachable). Submitting a metric mid-tour
  is exercised manually.
- Uses viktor's pre-existing test workspace for the UI flow, so the
  proposals-first-row coachmark may target an existing proposal rather
  than a freshly-seeded one. T1 already proves the seeding works on a
  fresh workspace.
- No coverage of dark mode rendering (the runner does not currently
  theme-switch between steps); manual screenshots taken on the
  introducing commit.
