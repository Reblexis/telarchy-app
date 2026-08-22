---
id: 02-workspaces-owner-controls
tags: [browse, slow]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As the owner of a floor, I can add a number and deepen the market I am
  looking at without leaving the floor; and a visitor who does not run the
  place never sees either control.
---

# Browse test: the owner's controls on their own floor

## What this tests

`src/components/FloorOwnerTools.tsx`, mounted on the floor by `TradePage`,
against `POST /api/metrics` and `POST /api/predictions/markets/:id/liquidity`.
The behavioural contract is `docs/operator-setup.md`: the owner side is two
controls on the floor itself, not a settings page, and the number they add has
to end as a LIVE market rather than a metric nobody can trade.

Both endpoints are gated server-side (`manage` for the metric, `trade` plus
your own balance for the liquidity), so the UI gate is a courtesy; T4 checks
the server actually refuses rather than trusting the hidden button.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init

# The owner: their own workspace, created through the open creation path.
OWNER="qa+owner-controls-$TT_RUN_ID@example.test"
read OJAR OUID < <(tt_mkuser_uid "$OWNER" "testtest123" "Owner-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$OJAR'"

WS=$(curl -sf -b "$OJAR" -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg n "Owner Controls $TT_RUN_ID" '{name:$n, template:"blank"}')" \
  "$TT_BASE_URL/api/workspaces")
WS_ID=$(jq -r .id <<<"$WS")
WS_SLUG=$(jq -r .slug <<<"$WS")
tt_on_cleanup "tt_rm_workspace '$WS_ID'"

# A stranger, signed in, who does not run this place.
STRANGER="qa+owner-controls-stranger-$TT_RUN_ID@example.test"
read SJAR SUID < <(tt_mkuser_uid "$STRANGER" "testtest123" "Stranger-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$SJAR'"

# The floor has to be readable by them to be a fair test of the CONTROL being
# hidden rather than the page being hidden.
curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS_ID" -H 'Content-Type: application/json' \
  -X PUT -d '{"visibility":"unlisted"}' "$TT_BASE_URL/api/workspaces/$WS_ID/settings" >/dev/null

# Credits to fund with: managed credits are admin-granted (vision.md), so the
# grant stands in for the money rail that does not exist yet.
curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS_ID" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg a "$OUID" '{agentId:$a, amount:5000, reason:"qa owner-controls"}')" \
  "$TT_BASE_URL/api/admin/credits" >/dev/null
```

## Tests

### T1. The owner adds a number and gets a live market

```bash
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$OWNER"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle

$B goto "$TT_FRONTEND_URL/$WS_SLUG" && $B wait --networkidle
$B assert-visible 'section[aria-label="Yours to run"]'
$B click 'section[aria-label="Yours to run"] button:has-text("Add a number")'
$B fill '#own-metric-name' "Monthly disputes arbitrated"
$B fill '#own-metric-source' "Counted on-chain, read on the first of the month."
$B fill '#own-metric-ceiling' "5000"
$B click 'button:has-text("Open the market")'
$B wait --networkidle
```

**Expected:** the section reports the market is open, and the floor now shows
a clock for it. The check that matters is server-side, because a metric
without a horizon renders as a workspace with nothing to trade:

```bash
mk=$(curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS_ID" "$TT_BASE_URL/api/predictions/markets")
jq -e '[.[] | select(.metricName == "Monthly disputes arbitrated")] | length >= 1' <<<"$mk" >/dev/null
jq -e '[.[] | select(.metricName == "Monthly disputes arbitrated")][0] | .liquidity > 0' <<<"$mk" >/dev/null
jq -e '[.[] | select(.metricName == "Monthly disputes arbitrated")][0] | .rangeMax == 5000' <<<"$mk" >/dev/null
MKT=$(jq -r '[.[] | select(.metricName == "Monthly disputes arbitrated")][0].id' <<<"$mk")
```

### T2. The owner deepens the market on screen

```bash
before=$(curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS_ID" "$TT_BASE_URL/api/predictions/markets/$MKT" | jq -r .liquidity)

$B goto "$TT_FRONTEND_URL/$WS_SLUG" && $B wait --networkidle
$B click 'section[aria-label="Yours to run"] button:has-text("Deepen this market")'
$B fill '#own-liq-amount' "500"
$B click 'section[aria-label="Yours to run"] button:has-text("Add")'
$B wait --networkidle

after=$(curl -sf -b "$OJAR" -H "X-Workspace-Id: $WS_ID" "$TT_BASE_URL/api/predictions/markets/$MKT" | jq -r .liquidity)
awk -v a="$before" -v b="$after" 'BEGIN { exit !(b > a) }'
```

**Expected:** liquidity rises, and the owner's balance falls by the credits
they added. The market funded is the one the page was showing; with more than
one clock open, stepping the arrows and funding again must move the OTHER
market, never the first in the list.

### T3. A visitor who does not run the place sees no controls

```bash
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$STRANGER"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
$B goto "$TT_FRONTEND_URL/$WS_SLUG" && $B wait --networkidle
$B assert-visible '.pubws-instrument'
$B assert-hidden 'section[aria-label="Yours to run"]'
```

**Expected:** they can read the floor and cannot see either control.

### T4. The server refuses them too

```bash
code=$(curl -s -b "$SJAR" -H "X-Workspace-Id: $WS_ID" -H 'Content-Type: application/json' \
  -o /dev/null -w '%{http_code}' -X POST \
  -d '{"name":"Mine now","value":0,"formula":"","marketRangeMax":10}' "$TT_BASE_URL/api/metrics")
[ "$code" = "403" ] || { echo "stranger created a metric: $code"; exit 1; }
```

**Expected:** `403`. The hidden button is not the gate.

## Known gaps

- Nothing here drives the two-clock case in T2's expectation; it is asserted
  in prose and covered in `src/components/__tests__/FloorOwnerTools.test.tsx`
  by passing the market explicitly.
- The credits the owner funds with are an admin grant. When the money rail
  exists (`vision.md`, item 3 of "The owner side reopens") this setup should
  buy them instead, and that path needs its own spec.
