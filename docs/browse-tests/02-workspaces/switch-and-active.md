---
id: 02-workspaces-switch-and-active
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As a participant who belongs to multiple workspaces, I can switch the
  active workspace from the sidebar; subsequent reads (metrics, markets,
  balance) reflect the chosen workspace; and the choice persists across
  reload.
---

# Browse test: Workspace switcher and active state

## What this tests

The workspace switcher in the sidebar — the load-bearing piece of multi-
workspace UX. Switching must:
- update `localStorage.activeWorkspaceId`,
- update the `X-Workspace-Id` header on subsequent API calls,
- not require a hard reload to refresh metric/market lists,
- survive a manual reload.

## Preconditions

- A signed-up user with at least two workspaces. We create both fresh.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
EMAIL="qa+sw-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "SwUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
# Browser-session callers must accept consent before any non-/auth route works.
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -X POST -d '{"accepted":true}' "$TT_BASE_URL/api/auth/consent" >/dev/null
WS_A=$(tt_mkworkspace personal public)
WS_B=$(tt_mkworkspace startup public)
tt_on_cleanup "tt_rm_workspace '$WS_A'"
tt_on_cleanup "tt_rm_workspace '$WS_B'"
# membership: add the user (by participant id, not email) to both as admin
tt_add_member "$WS_A" "$MUID" "admin"
tt_add_member "$WS_B" "$MUID" "admin"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
# Force navigation away from /login so the rest of the test runs on an
# authed page even if the BetterAuth client's post-login redirect hasn't
# settled yet.
$B goto "$TT_FRONTEND_URL/start" && $B wait --networkidle
```

## Tests

### T1. Both workspaces appear in the sidebar

```bash
sidebar=$($B text)
grep -q "$(tt_admin_curl "$WS_A" "$TT_BASE_URL/api/workspaces/$WS_A" | jq -r '.name')" <<<"$sidebar"
grep -q "$(tt_admin_curl "$WS_B" "$TT_BASE_URL/api/workspaces/$WS_B" | jq -r '.name')" <<<"$sidebar"
```

### T2. Click WS_B → metrics list reflects WS_B's metrics

The switcher is a button-then-dropdown; open the menu first, then click
the workspace by `data-workspace-id`.

```bash
$B click '[data-testid="workspace-switcher-toggle"]'
$B click "[data-workspace-id='$WS_B']"
$B wait --networkidle
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
api_b=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS_B" "$TT_BASE_URL/api/metrics" | jq -r '.[].name' | sort -u)
ui=$($B text)
while IFS= read -r name; do
  [ -z "$name" ] && continue
  grep -qF "$name" <<<"$ui" || { echo "WS_B metric '$name' not on /metrics"; exit 1; }
done <<<"$api_b"
```

### T3. localStorage.activeWorkspaceId is WS_B

```bash
got=$($B js 'localStorage.getItem("activeWorkspaceId")')
[ "$got" = "\"$WS_B\"" ] || [ "$got" = "$WS_B" ] \
  || { echo "activeWorkspaceId not WS_B: $got"; exit 1; }
```

### T4. Reload preserves the active workspace

```bash
$B reload && $B wait --networkidle
got=$($B js 'localStorage.getItem("activeWorkspaceId")')
[ "$got" = "\"$WS_B\"" ] || [ "$got" = "$WS_B" ]
```

### T5. Switching back updates active without a hard reload

```bash
$B click "a:has-text(\"$(tt_admin_curl "$WS_A" "$TT_BASE_URL/api/workspaces/$WS_A" | jq -r '.name')\")"
$B wait --networkidle
got=$($B js 'localStorage.getItem("activeWorkspaceId")')
[ "$got" = "\"$WS_A\"" ] || [ "$got" = "$WS_A" ]
```

### T6. Stale workspace id falls back gracefully (commit 660ba6c)

```bash
# Manually clobber localStorage to a workspace the user is not a member of.
$B js "localStorage.setItem('activeWorkspaceId','non-existent-ws-$TT_RUN_ID')"
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B console --errors > "/tmp/$TT_NS-console.txt"
[ -s "/tmp/$TT_NS-console.txt" ] && cat "/tmp/$TT_NS-console.txt"
# UI should not be broken: metric cards or empty-state must be present.
$B is visible 'main, [data-testid="dashboard"], h1'
```

## Cleanup

Auto.

## Known gaps

- No assertion on header `X-Workspace-Id` actually changing on the wire
  (would need `$B network` snapshot diff).
- Multi-workspace badge counters are not asserted.
