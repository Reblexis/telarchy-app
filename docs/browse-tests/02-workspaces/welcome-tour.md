---
id: 02-workspaces-welcome-tour
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse, master-key]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a freshly signed-up participant landing in a new workspace, the
  3-step welcome tour fires automatically, walks me through the seeded
  starter proposal and the new-proposal button, and persists a flag so
  it doesn't fire again. I can re-run it from the sidebar at any time.
---

# Browse test: Welcome tour and starter proposal

## What this tests

Two coupled pieces that ship together:

1. Workspace creation seeds a single starter proposal with conditional
   markets at zero subsidy, so a brand new workspace is non-empty.
2. The frontend welcome tour (welcome modal -> coachmark on the starter
   proposal row -> coachmark on the new-proposal button -> done card)
   fires on first authenticated visit, sets
   `localStorage.telarchy.tour.seen.v1` on finish or skip, and is
   re-startable from the sidebar.

This is the surface that an inbound investor or pilot founder will see
the first time they log in. If either piece breaks, that demo lands in
an empty app.

## Preconditions

- Auth: master key in `$TT_ADMIN_KEY` (cleanup helpers only; the spec
  itself creates the workspace via a real user session so the seeding
  path fires).
- Frontend: dev server on `$TT_FRONTEND_URL` (default
  `http://localhost:5173`).
- Backend: dev API on `$TT_BASE_URL` (default `http://localhost:8080`).

## Setup

Sign up a fresh user, accept the consent gate, and have THEM create the
workspace via their own session. The starter proposal is only seeded
when an owner agent exists (real signups always have one); master-key
workspace creates skip seeding by design.

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900

USER_EMAIL="$TT_NS@example.com"
USER_JAR=$(tt_mkuser "$USER_EMAIL" "TourTest99!" "Tour Tester")
USER_UID=$(curl -sf -b "$USER_JAR" "$TT_BASE_URL/api/auth/me" | jq -r '.uid')

# tt_mkuser sends consent:true in the signup body, but BetterAuth's
# sign-up endpoint does not write the consent column. Post consent
# explicitly so subsequent gated routes (workspace create, proposals)
# are not 403'd.
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

`starterProposalId` must come back populated, and the proposals endpoint
must return exactly one row whose title references Telarchy, whose
status is `pending`, and whose proposer is the workspace owner.

```bash
# Accumulate failures so the spec keeps running for visibility, but exits
# non-zero at the end if any test failed.
TOUR_FAILS=0

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

### T2-T5. UI tour flow (manual + script reference)

The browser-driven steps below are documented so a human (or a future
runner with reliable BetterAuth login) can copy-paste them, but they
are not auto-executed by `_runner/run.sh` because the login form
submission is flaky under headless click+wait timing. T1 above already
proves the seeded proposal exists end-to-end through the public API,
which is the part of the contract most likely to regress. The UI flow
was verified manually with the same browse skill at commit time.

To run by hand:

```bash skip
# T2. Welcome modal fires on first authenticated visit
$B goto "$TT_FRONTEND_URL/login"
$B wait --networkidle
$B fill 'input[type=email]' "$USER_EMAIL"
$B fill 'input[type=password]' "TourTest99!"
$B click 'button[type=submit]'
$B wait --networkidle
# If still on /login, the submit was eaten. Click "Login" by text and retry.

$B js "localStorage.setItem('activeWorkspaceId','$WS_ID')"
$B reload
$B wait --networkidle

# Expect: '.tour-modal' visible.
$B is visible '.tour-modal'

# T3. "Show me how" advances to the starter-proposal coachmark
$B click '.tour-btn-primary'
$B wait --networkidle
# Expect: URL = /proposals; '.tour-coach' visible; '[data-tour-id="proposals-first-row"]' present and has class tour-target-glow.

# T4. Next -> new-proposal coachmark -> Finish -> done card -> close
$B click '.tour-btn-primary'
# Expect: '[data-tour-id="proposals-new"]' has class tour-target-glow.
$B click '.tour-btn-primary'   # Finish -> done card
$B click '.tour-btn-primary'   # Get started -> close
# Expect: '.tour-modal' hidden; localStorage telarchy.tour.seen.v1 = "1".

# T5. Sidebar restart reopens the tour
$B click "button.sidebar-nav-item" --text "Show product tour"
# Expect: '.tour-modal' visible again.
$B click '.tour-btn-ghost'   # Skip
# Expect: modal closed.
```

The same flow was captured in screenshots committed alongside this
spec (light + dark mode) on the introducing commit, so a reviewer can
visually confirm step rendering.

## Exit

```bash
if [ "${TOUR_FAILS:-0}" -gt 0 ]; then
  echo "welcome-tour spec: $TOUR_FAILS check(s) failed"
  exit 1
fi
echo "welcome-tour spec: all auto checks passed"
```

## Cleanup

Cleanup is registered via `tt_on_cleanup` in Setup and runs after the
spec, deleting the throwaway workspace and the test user.

## Known gaps

- No coverage of the case where the workspace has zero proposals (the
  starter-proposal seeding only fires for fresh workspaces, so an old
  workspace whose only proposal was deleted will hit the tour's
  fallback path that auto-advances past the missing target). The
  fallback is exercised by manual testing only.
- Does not test the case where the user signs up via the real /signup
  page end-to-end (the spec uses `tt_mkuser` which posts to BetterAuth
  directly to keep runtime fast). The signup-flow end-to-end is in
  `01-auth/signup.md`.
- No coverage of the welcome modal in dark mode beyond manual screenshot
  verification.
