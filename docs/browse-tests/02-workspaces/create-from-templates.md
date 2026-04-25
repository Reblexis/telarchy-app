---
id: 02-workspaces-create-from-templates
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a freshly signed-up participant, I can pick a workspace template,
  land on a usable first screen with seeded metrics, switch between
  workspaces, change settings, and delete a workspace cleanly.
---

# Browse test: Workspaces (create, switch, settings, delete)

## What this tests

Creating a workspace from a template, switching the active workspace via the
sidebar, editing settings (name, visibility, auto-fund), and deleting a
workspace (which voids open markets and refunds stakes).

Maps to `mvp-evaluation-plan.md` Sections 3 and 6.

## Preconditions

- Authenticated user.
- Account is allowed to create workspaces (default for browser sign-ups).

## Setup

```bash
$B viewport 1440x900
$B goto https://telarchy.com/workspaces/new
$B wait --networkidle
$B screenshot /tmp/workspace-create.png
```

## Tests

### T1. Template picker shows the documented options

**Steps:** `$B snapshot -i` and check option labels.

**Expected:** At minimum `startup`, `personal`, `blank` visible.

### T2. Create a workspace from each template

**Steps:**
1. For each template: enter a unique name, submit.
2. After redirect: `$B url` and `$B text`.
3. Verify default metrics exist: `curl -s -b <cookie> -H "X-Workspace-Id: <id>" https://telarchy.com/api/metrics | jq 'length'`.

**Expected:**
- Redirect to `/check-in?welcome=1` (or current first-screen).
- Metrics count > 0 for `startup` and `personal`; 0 for `blank`.
- `Public` group capabilities default per template (open templates grant
  `[read, trade]`; private/blank grants `[read]`).

### T3. Visibility default

**Steps:** Create a workspace, then `$B goto /workspaces/<id>/settings` and
`$B is checked <visibility-public-ref>`.

**Expected:** Default is `public` (per the recent activation hook commit).

### T4. Sidebar workspace switch

**Steps:**
1. With at least two workspaces, click another in the sidebar.
2. `$B url`
3. Verify the page content (metric names) changed.

**Expected:** The active workspace state in `localStorage.activeWorkspaceId`
matches the new id; sidebar highlights the chosen workspace.

### T5. Edit workspace settings

**Steps:**
1. From settings, change name. Save.
2. Reload. Verify name persists.
3. Toggle auto-fund. Save.
4. Verify subsequent market creation debits the owner's balance per
   `newMarketLiquidityCredits`.

**Expected:** All persisted, no console errors.

### T6. Delete workspace voids markets and refunds stakes

**Steps:**
1. In a throwaway workspace with at least one funded market and one trade,
   capture the trader's balance.
2. Delete the workspace from settings.
3. Confirm the destructive prompt.
4. Re-fetch the trader's balance.

**Expected:**
- Workspace gone from `/api/workspaces`.
- Trader's balance restored to within LMSR-spread rounding of pre-trade.

## Cleanup

Delete throwaway workspaces created by T2 / T6 to keep the test fixtures
minimal.

## Known gaps

- No coverage of the `unlisted` visibility (joinable via direct link, not
  marketplace-listed). Add a test once the link-only join surface stabilises.
- No coverage of role/membership changes via `/api/workspaces/<id>/members`.
  Defer to a `permissions.md` spec when one is added.
