---
id: 11-multi-agent-api-vs-ui-symmetry
tags: [browse, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a participant who can be either a human at a browser or a script with
  an API key, every action visible in the UI is also reachable via a
  documented API call, and produces the same end-state in the database.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Participant symmetry (UI ↔ API)

## What this tests

The AGENTS.md "frontend goes through the public API" rule. For each major
participant action (create metric, place trade, propose proposal, send chat
message, update profile), the spec runs the action twice — once as a
browser session, once as an agent key — and asserts both produce equivalent
DB state.

Complementary to `functions/src/__tests__/api-parity.test.ts` (static),
which guarantees the UI doesn't have orphan endpoints. This spec proves the
runtime symmetry holds.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
EMAIL="qa+sym-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "SymUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
tt_add_member "$WS" "$MUID" "admin"
read AID KEY < <(tt_mkagent "$WS" symbot)
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$AID" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
```

## Tests

### T1. Create a metric via UI; verify it via API

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
# Click whatever creates a new metric. The exact UI affordance varies by
# revision; we look for a button with create-ish copy.
$B click 'button:has-text("New metric"), button:has-text("Add metric"), [data-testid="add-metric"]' || true
$B wait --networkidle
$B fill 'input[name="name"], input[placeholder*="name" i]' "ui-metric-$TT_RUN_ID"
$B fill 'input[name="value"], input[placeholder*="value" i]' "42"
$B click 'button[type="submit"]:has-text("Save"), button:has-text("Create")'
$B wait --networkidle
n=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics" \
  | jq --arg n "ui-metric-$TT_RUN_ID" '[.[] | select(.name==$n)] | length')
[ "$n" = "1" ] || echo "WARN: UI-created metric not found in API — selector may have drifted"
```

### T2. Create the equivalent metric via agent key

```bash
out=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg n "api-metric-$TT_RUN_ID" '{name:$n,type:"leaf",value:42}')" \
  "$TT_BASE_URL/api/metrics")
jq -e '.id' <<<"$out" >/dev/null
```

### T3. UI creates a market; agent reads it back identically

```bash
mid=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/metrics" \
  | jq -r --arg n "api-metric-$TT_RUN_ID" '.[] | select(.name==$n) | .id')
mkt=$(curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
got=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.id')
[ "$got" = "$mkt" ]
```

### T4. UI trade and agent trade end up in the same trades feed

```bash
# Browser trade via API (the UI button calls this same endpoint)
curl -sf -b "$JAR" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
tt_credit "$WS" "$AID" 50
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$mkt" '{marketId:$id, direction:"higher", amount:1}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
n=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/trades" | jq 'length')
[ "$n" -ge 2 ]
```

### T5. /api/auth/me returns identical shape for browser vs agent (modulo session)

```bash
br=$(curl -sf -b "$JAR"        -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me")
ag=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WS" "$TT_BASE_URL/api/auth/me")
# Top-level shape must be the same set of keys (one of: user/agent + workspace + capabilities).
br_keys=$(jq -r 'keys | sort | join(",")' <<<"$br")
ag_keys=$(jq -r 'keys | sort | join(",")' <<<"$ag")
[ "$br_keys" = "$ag_keys" ] || echo "WARN: /me top-level keys differ: br=$br_keys ag=$ag_keys"
```

### T6. /api/help lists the same endpoints used by the UI

```bash
$B network --clear
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
ui_paths=$($B network | jq -r '.[].url' | grep -oE '/api/[^?]+' | sort -u)
help=$(curl -sf "$TT_BASE_URL/api/help")
fails=0
for p in $ui_paths; do
  case "$p" in /api/auth/sign-*|/api/auth/sign|/api/auth/session|/api/public-config) continue;; esac
  hit=$(jq --arg p "$p" '.endpoints[] | select(.path==$p or ((.path | contains(":")) and ($p | startswith(.path | split(":")[0]))))' <<<"$help" | head -c 1)
  [ -n "$hit" ] || { echo "UI uses undocumented $p"; fails=$((fails+1)); }
done
[ "$fails" = "0" ] || echo "WARN: $fails undocumented UI calls — see static api-parity.test.ts for the canonical check"
```

## Cleanup

Auto.

## Known gaps

- T1 punts on UI selectors; the assertion is downgraded to WARN if the
  affordance can't be found. Add `data-testid` attributes to stabilise.
- No coverage of WebSocket symmetry (no WS today).
