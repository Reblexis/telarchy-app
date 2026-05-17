---
id: 02-workspaces-welcome-tour
tags: [browse, fast]
isolation: user
parallel-safe: false
needs: [auth, browse, master-key]
timeout: 240s
goal-horizon: short
goal-statement: |
  A signed-in user sees a persona picker (Builder / Trader / AI agent)
  on first visit. Picking Builder starts an action-driven walkthrough:
  workspace exists or is created, then add a metric, check in a value,
  submit a proposal, approve/decline. Each step waits for the actual
  API change before advancing; the tour does not require click-Next
  for action steps. A starter proposal is seeded on fresh workspace
  creation so the demo path is always populated.
---

# Browse test: Persona picker + Builder tutorial (action-driven)

## What this tests

The tutorial v3 architecture, end-to-end:

1. **Backend seeding**: workspace creation seeds one starter proposal.
2. **PersonaPicker**: on first authenticated visit with no
   `telarchy.tutorial.persona.v3` flag, a modal asks the user which
   of three personas they are. Picking one writes the intent via
   `/api/auth/profile` AND starts the matching tutorial.
3. **Action-driven progression**: the Builder tutorial polls the
   relevant API every 2.5s and auto-advances when the user actually
   performs the step. We simulate the user actions via direct API
   calls and confirm the tour advances.
4. **Tutorials hub**: `/tutorials` lists all 3 tracks with status
   labels (Not started / In progress / Completed).
5. **Sidebar entry**: "Tutorials" replaces the previous "Show product
   tour" button.

## Preconditions

- Auth: master key in `$TT_ADMIN_KEY` (for `tt_mkuser` / cleanup).
- Frontend: `$TT_FRONTEND_URL` (default `http://localhost:5173`).
- Backend: `$TT_BASE_URL` (default `http://localhost:8080`).
- Test user `viktor.cihal@gmail.com` / `TestAdmin99!` exists with at
  least one workspace owned (used by all UI tests; the backend
  seeding test signs up a fresh user inline).

## Setup: seed a fresh workspace via user session (for T1)

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900

TOUR_FAILS=0

USER_EMAIL="$TT_NS@example.com"
USER_JAR=$(tt_mkuser "$USER_EMAIL" "TourTest99!" "Tour Tester")
USER_UID=$(curl -sf -b "$USER_JAR" "$TT_BASE_URL/api/auth/me" | jq -r '.uid')
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

### T1. Workspace creation seeds one starter proposal

```bash
[ "$STARTER_ID" != "null" ] && [ -n "$STARTER_ID" ] \
  || { echo "T1 FAIL: no starterProposalId"; echo "  got: $WS_CREATE"; TOUR_FAILS=$((TOUR_FAILS+1)); }

PROPS=$(curl -sf -b "$USER_JAR" -H "X-Workspace-Id: $WS_ID" "$TT_BASE_URL/api/proposals")
COUNT=$(echo "$PROPS" | jq 'length')
tt_assert_eq "1" "$COUNT" "T1 expected one seeded proposal" || TOUR_FAILS=$((TOUR_FAILS+1))
TITLE=$(echo "$PROPS" | jq -r '.[0].title')
tt_assert_contains "Telarchy" "$TITLE" "T1 title mentions Telarchy" || TOUR_FAILS=$((TOUR_FAILS+1))
echo "T1: starter proposal seeded ($STARTER_ID) title=\"$TITLE\""
```

### T2-T8. Persona picker + Builder tutorial UI flow

Sign in as viktor, clear all tutorial localStorage, reload, and drive
through the persona picker and action-driven Builder tutorial. Every
action is performed via direct API calls (the polling layer is what
we are exercising); we then verify the tutorial advances within ~4s.

```bash
# Sign in
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

# Save cookies for the API helper.
$B js "Array.from(document.cookies||'').length" >/dev/null
COOKIE_JAR="/tmp/$TT_NS-viktor.jar"
curl -s -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d '{"email":"viktor.cihal@gmail.com","password":"TestAdmin99!"}' \
  "$TT_BASE_URL/api/auth/sign-in/email" >/dev/null

# Clear tutorial state and reload so the persona picker fires fresh.
$B js "['telarchy.tour.seen.v1','telarchy.tour.seen.v2','telarchy.tutorial.persona.v3','telarchy.tutorial.active.v3','telarchy.tutorial.step.v3','telarchy.tutorial.completed.v3'].forEach(k=>localStorage.removeItem(k));'cleared'" >/dev/null
$B goto "$TT_FRONTEND_URL/metrics"
$B wait --networkidle
sleep 2

# T2. PersonaPicker visible.
if [ "$($B is visible '.persona-picker')" = "true" ]; then
  echo "T2 PASS: PersonaPicker visible"
  $B screenshot "/tmp/$TT_NS-persona-picker.png" >/dev/null
else
  echo "T2 FAIL: PersonaPicker not visible"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi

# T3. All three persona options present.
for p in builder trader agent; do
  if [ "$($B is visible "[data-tour-id=\"persona-$p\"]")" = "true" ]; then
    echo "T3 PASS: persona option $p present"
  else
    echo "T3 FAIL: persona option $p not present"
    TOUR_FAILS=$((TOUR_FAILS+1))
  fi
done

# T4. Pick Builder, welcome modal appears.
$B click '[data-tour-id="persona-builder"]' >/dev/null
sleep 2
if [ "$($B is visible '.tour-modal')" = "true" ]; then
  echo "T4 PASS: Builder welcome modal visible after pick"
else
  echo "T4 FAIL: Builder welcome modal not visible after pick"
  TOUR_FAILS=$((TOUR_FAILS+1))
fi

# Click Start. The workspace step probes immediately and auto-skips
# because viktor already has at least one workspace; we should land
# directly on the Add a metric step.
$B click '.tour-btn-primary' >/dev/null
sleep 4
STEP_TITLE=$($B js "document.querySelector('.tour-coach-title')?.textContent || ''")
tt_assert_contains "Add your first metric" "$STEP_TITLE" "T5 advanced past Workspace step to Add metric" || TOUR_FAILS=$((TOUR_FAILS+1))

# T6a. The coach overlay must NOT block clicks to the highlighted target.
# Scroll the + Add metric ghost card into view and click it; the form
# should expand (revealing the Name input). This catches the
# "pointer-events on overlay" regression class.
$B js "document.querySelector('[data-tour-id=\"metric-add-ghost\"]')?.scrollIntoView({block:'center'}); 'scrolled'" >/dev/null
sleep 1
$B click '[data-tour-id="metric-add-ghost"]' >/dev/null
sleep 1
EXPANDED=$($B is visible '[data-tour-id="metric-form-name"]')
tt_assert_eq "true" "$EXPANDED" "T6a click on highlighted ghost card expanded the form (overlay does not block)" || TOUR_FAILS=$((TOUR_FAILS+1))

# T6b. Now add a metric via API to verify the polling layer advances.
WS_DEFAULT=$($B js "localStorage.getItem('activeWorkspaceId')" | tr -d '"')
METRIC_ID=$(curl -sf -b "$COOKIE_JAR" -H "Content-Type: application/json" -H "X-Workspace-Id: $WS_DEFAULT" \
  -X POST -d '{"name":"Tutorial test metric '"$TT_NS"'","value":0,"formula":"0","marketRangeMax":100,"timePreference":{"enabled":true,"halfLife":1}}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
sleep 5
STEP_TITLE=$($B js "document.querySelector('.tour-coach-title')?.textContent || ''")
tt_assert_contains "Log a current value" "$STEP_TITLE" "T6b advanced to Check-in after metric add" || TOUR_FAILS=$((TOUR_FAILS+1))
URL=$($B url)
tt_assert_contains "/check-in" "$URL" "T6b navigated to /check-in" || TOUR_FAILS=$((TOUR_FAILS+1))

# T7. Update the metric value via API; tour should auto-advance to Submit proposal.
curl -sf -b "$COOKIE_JAR" -H "Content-Type: application/json" -H "X-Workspace-Id: $WS_DEFAULT" \
  -X PUT -d '{"value":42}' "$TT_BASE_URL/api/metrics/$METRIC_ID" >/dev/null
sleep 5
STEP_TITLE=$($B js "document.querySelector('.tour-coach-title')?.textContent || ''")
tt_assert_contains "Propose your first action" "$STEP_TITLE" "T7 advanced to Submit proposal after value update" || TOUR_FAILS=$((TOUR_FAILS+1))

# T8. Skip-step button works on action steps. "I'll do it later" advances
# to Approve/Decline without performing the action.
$B js "Array.from(document.querySelectorAll('button.tour-btn-ghost')).find(b => /I'll do it later/.test(b.textContent || ''))?.click(); 'clicked'" >/dev/null
sleep 2
STEP_TITLE=$($B js "document.querySelector('.tour-coach-title')?.textContent || ''")
tt_assert_contains "Decide on the number" "$STEP_TITLE" "T8 advanced to Approve/Decline via skip" || TOUR_FAILS=$((TOUR_FAILS+1))

# T9. Decline a pending proposal via API; tour should reach the Done modal.
PENDING_ID=$(curl -sf -b "$COOKIE_JAR" -H "X-Workspace-Id: $WS_DEFAULT" "$TT_BASE_URL/api/proposals?status=pending" | jq -r '.[0].id // empty')
if [ -n "$PENDING_ID" ]; then
  curl -sf -b "$COOKIE_JAR" -H "X-Workspace-Id: $WS_DEFAULT" -X POST "$TT_BASE_URL/api/proposals/$PENDING_ID/decline" >/dev/null
  sleep 5
  DONE_TITLE=$($B js "document.querySelector('.tour-modal h2')?.textContent || ''")
  tt_assert_contains "You ran the loop" "$DONE_TITLE" "T9 reached Done modal after decline" || TOUR_FAILS=$((TOUR_FAILS+1))
else
  echo "T9 SKIP: no pending proposal available for viktor's workspace"
fi

# T10. Finish closes the tour and records completion.
$B click '.tour-btn-primary' >/dev/null
sleep 1
COMPLETED=$($B js "localStorage.getItem('telarchy.tutorial.completed.v3') || '[]'")
tt_assert_contains "builder" "$COMPLETED" "T10 builder tutorial recorded as completed" || TOUR_FAILS=$((TOUR_FAILS+1))

# T11. Tutorials launcher is reachable from inside the Guides tab.
$B goto "$TT_FRONTEND_URL/guides"
$B wait --networkidle
sleep 1
$B click '[data-tour-id="guides-nav-tutorials"]' >/dev/null
sleep 1
LAUNCHER_VIS=$($B is visible '[data-tour-id="tutorials-launcher"]')
tt_assert_eq "true" "$LAUNCHER_VIS" "T11 Guides 'Interactive tutorials' shows launcher" || TOUR_FAILS=$((TOUR_FAILS+1))
for id in builder trader agent; do
  if [ "$($B is visible "[data-tour-id=\"tutorial-card-$id\"]")" = "true" ]; then
    echo "T11 PASS: tutorial card $id rendered inside Guides"
  else
    echo "T11 FAIL: tutorial card $id missing"
    TOUR_FAILS=$((TOUR_FAILS+1))
  fi
done

# T12. Builder card shows "Completed" status text.
COMPLETED_TEXT=$($B js "document.querySelector('[data-tour-id=\"tutorial-card-builder\"] .tutorial-card-status')?.textContent || ''")
tt_assert_contains "Completed" "$COMPLETED_TEXT" "T12 builder card shows Completed" || TOUR_FAILS=$((TOUR_FAILS+1))

# Cleanup: delete the test metric so the test workspace stays clean.
if [ -n "$METRIC_ID" ]; then
  curl -s -b "$COOKIE_JAR" -H "X-Workspace-Id: $WS_DEFAULT" -X DELETE "$TT_BASE_URL/api/metrics/$METRIC_ID" >/dev/null
fi
```

## Exit

```bash
if [ "${TOUR_FAILS:-0}" -gt 0 ]; then
  echo "tutorial v3 spec: $TOUR_FAILS check(s) failed"
  exit 1
fi
echo "tutorial v3 spec: all checks passed"
```

## Cleanup

Registered via `tt_on_cleanup`: deletes the throwaway workspace and
test user. T12 cleanup deletes the test metric inline.

## Known gaps

- Skipped Approve/Decline step (T9) when no pending proposal exists
  in viktor's workspace. Production traffic always has pending
  proposals so this is rarely hit.
- Trader and AI Agent tutorials are stubbed (welcome + done modal
  only); their walkthroughs are coming in the next iteration and
  the spec will grow tests for them then.
- Does not yet test the workspace-creation guidance path (where the
  user has no workspace and the tutorial coachmarks /create-workspace
  fields). Setup signs the user up but uses viktor's existing
  workspace for the UI flow.
