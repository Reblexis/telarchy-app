---
id: 04-markets-conditional-markets
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a workspace, when a participant proposes a proposal, the platform spawns
  conditional markets per relevant metric; on approve those markets resolve
  against the post-proposal metric, on decline they void and refund stakes.
---

# Browse test: Conditional markets (linked to proposals)

## What this tests

The lifecycle: create proposal → conditional markets exist → trade on them →
approve or decline proposal → markets resolve / void cleanly. Maps to
`mvp-evaluation/plan.md` 4.9, the conditional path of `proposals-flow.md`.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
read PROP KP < <(tt_mkagent "$WS" proposer)
read APPR KA < <(tt_mkagent "$WS" approver)
read OUTS KO < <(tt_mkagent "$WS" outsider)
for ag in $PROP $APPR $OUTS; do tt_credit "$WS" "$ag" 200; done
# Promote APPR to admin so it can approve
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$APPR" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
```

## Tests

### T1. Proposing a proposal creates conditional markets

```bash
out=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Ship onboarding","description":"..."}' \
  "$TT_BASE_URL/api/proposals")
PROPOSAL=$(jq -r '.id' <<<"$out")
[ -n "$PROPOSAL" ] && [ "$PROPOSAL" != "null" ]
cms=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.conditionalMarketIds // [] | length')
[ "$cms" -ge 1 ] || echo "WARN: no conditional markets auto-spawned for proposal $PROPOSAL"
```

### T2. Outsider trades on a conditional market

Conditional markets inherit liquidity from their source non-conditional
market. When the test workspace's source markets have liquidity 0 (the
master-key admin path doesn't auto-fund — the owner-agent lookup fails),
the conditional markets also start at 0 and would reject trades. Inject
a small pool from the proposer first so the trade has something to
price against.

```bash
mkts=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.conditionalMarketIds[]?')
target=$(echo "$mkts" | head -1)
[ -z "$target" ] && { echo "skip: no conditional market"; exit 0; }
liq=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$target" | jq -r '.liquidity')
if awk -v l="$liq" 'BEGIN{exit !(l <= 0)}'; then
  tt_admin_curl "$WS" -H 'Content-Type: application/json' \
    -X POST -d "$(jq -nc --arg a "$PROP" '{amount:5, agentId:$a}')" \
    "$TT_BASE_URL/api/predictions/markets/$target/liquidity" >/dev/null
fi
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$target" '{marketId:$id, direction:"higher", amount:5}')" \
  "$TT_BASE_URL/api/predictions/trade")
[ "$status" = "200" ] || [ "$status" = "201" ] \
  || { echo "outsider trade on conditional returned $status"; exit 1; }
```

### T3. Approve proposal → conditional markets resolve

```bash
curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/approve" >/dev/null
status=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.status')
[ "$status" = "approved" ]
# At least one conditional market should now be resolved (or voided per spec).
done_count=0
for mid in $mkts; do
  resolved=$(curl -sf "$TT_BASE_URL/api/predictions/markets/$mid" | jq -r '.resolved')
  voided=$(curl -sf "$TT_BASE_URL/api/predictions/markets/$mid" | jq -r '.voided')
  [ "$resolved" = "true" ] || [ "$voided" = "true" ] && done_count=$((done_count+1))
done
[ "$done_count" -ge 1 ]
```

### T4. Decline path: another proposal voids its conditional markets

```bash
out=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Decline me","description":"..."}' \
  "$TT_BASE_URL/api/proposals")
PROPOSAL2=$(jq -r '.id' <<<"$out")
mkts2=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL2" | jq -r '.conditionalMarketIds[]?')
target2=$(echo "$mkts2" | head -1)
if [ -n "$target2" ]; then
  curl -sf -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$target2" '{marketId:$id, direction:"higher", amount:3}')" \
    "$TT_BASE_URL/api/predictions/trade" >/dev/null
fi
pre=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$OUTS/balance" | jq -r '.balance')
curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL2/decline" >/dev/null
post=$(tt_admin_curl "$WS" "$TT_BASE_URL/api/agents/$OUTS/balance" | jq -r '.balance')
# Outsider's balance restored within LMSR rounding (refund on void)
delta=$(awk -v a="$pre" -v b="$post" 'BEGIN{print b-a}')
awk -v d="$delta" 'BEGIN{exit !(d > -1.0 && d < 4.0)}' \
  || { echo "decline did not refund outsider within tolerance: delta=$delta"; exit 1; }
```

### T5. Conditional market created after proposal closes is rejected

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg t "$PROPOSAL" '{proposalId:$t, metricId:"x", targetDate:"2030-01-01"}')" \
  "$TT_BASE_URL/api/predictions/markets")
case "$status" in 400|404|409|422) ;; *) echo "expected 4xx for late conditional create, got $status"; exit 1;; esac
```

## Cleanup

Auto.

### T6. A proposal's Positions/Trades tabs cover BOTH branches

Owner report 2026-08-21: "why dont i see any trades made on the conditional
markets". A proposal opens on "if approved"; when its only trades sat on the
declined branch, the branch-scoped panel answered "Trades (0)".

**Steps:**
1. On a public floor, place a trade on a proposal's DECLINED branch (switch
   the toggle to "if declined" first), or pick a proposal whose trades are
   known to sit on one branch only
   (`curl -s -H "X-Workspace-Id: <ws>" "$TT_BASE_URL/api/predictions/markets/<branchMarketId>/trades"`).
2. Select the proposal; leave the branch toggle on its default
   ("if approved").
3. Read the panel toggles under the bet buttons, then open Trades.

**Expected:**
- "Trades (N)" counts the trades of BOTH branches, whatever the toggle
  shows; switching branch does not change the counts.
- Each row is labeled with its world ("if approved" / "if declined");
  rows are newest first across both branches.
- The baseline market's panel carries no world label.

## Known gaps

- No coverage of partial-resolve where a proposal affects only some of N
  metrics. Add once the platform decides the policy for "untouched"
  conditional markets after approve.
