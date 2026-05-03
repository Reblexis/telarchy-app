---
id: 02-workspaces-activity-tab
tags: [browse, fast]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 90s
goal-horizon: short
goal-statement: |
  As any workspace member, I can open the workspace's Activity tab and see
  a friendly, reverse-chronological feed of what participants have been
  doing (proposals proposed, markets created and resolved, KPIs updated,
  forecasts placed, liquidity added) without exposing financial events
  (deposits, withdrawals) or revealing who placed which forecast.
---

# Browse test: Workspace Activity tab

## What this tests

The workspace-scoped Activity tab is the user-friendly counterpart to
`/admin`'s activity feed. Unlike `/admin`:

- It is available to every workspace member (capability `read`), not only
  admins.
- It hides `deposit` and `withdrawal` events (financial info).
- It anonymizes the actor on `trade` entries (so non-admins cannot see who
  is forecasting what).
- It uses friendly summaries ("Alice proposed 'Migrate to Postgres' (250
  cr)") instead of raw shape dumps.

Backend: `GET /api/activity` (capability `read`).

## Preconditions

- A signed-in workspace member.
- The workspace already has at least one proposal, one market, and one trade
  (to populate the feed). The fixture script below creates these fresh.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
EMAIL="qa+act-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "ActUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/legal/consent" -d '{"document":"terms"}' >/dev/null
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/legal/consent" -d '{"document":"privacy"}' >/dev/null

# Create a workspace and capture its id.
WS_ID=$(curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -X POST "$BASE/api/workspaces" \
  -d '{"name":"Activity QA","template":"personal-goals"}' | jq -r .id)

# Propose a proposal to populate the feed.
curl -sf -b "$JAR" -H 'Content-Type: application/json' \
  -H "X-Workspace-Id: $WS_ID" \
  -X POST "$BASE/api/proposals" \
  -d '{"title":"Test proposal"}' >/dev/null
```

## Test

```bash
$B goto $BASE/login
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
$B goto $BASE/activity
$B wait --networkidle
$B snapshot -i
```

Expected:

- Page heading "Activity".
- Type chips visible (Proposals, Chat, Markets, Resolved, KPIs, Forecasts,
  Liquidity).
- The "Test proposal" proposal appears in the feed under a "Proposals" chip,
  summarized like `<actor> proposed "Test proposal" (100 cr)`.
- No `deposit` or `withdrawal` chip shown anywhere (member view does not
  expose financial events).
- A range selector (defaults to "24 hours") and Pause/Resume + Refresh
  buttons in the header.

## API parity

The new endpoint is documented in `GET /api/help` as `/api/activity`. The
api-parity test (`functions/src/__tests__/api-parity.test.ts`) keeps the
docs in sync; if the route is renamed or removed, that test fails.

## Known gaps

- This spec verifies the member-friendly view only. Admin behavior
  (full feed including `deposit`/`withdrawal`, identified trade actors,
  and ID filter inputs) is covered by `07-admin/activity-feed.md`.
