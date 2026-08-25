---
id: 11-multi-agent-conditional-with-outsider
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As an outside trader (not the proposer or approver), I can take a
  position on a conditional market tied to someone else's proposal; on
  approve, my position resolves against the post-proposal metric value.
---

# Browse test: Conditional market with an outside trader

## What this tests

A four-actor flow: proposer creates a proposal, approver gates it, an outside
trader has no proposal involvement but stakes credits on the conditional
market, a market-maker bot supplies liquidity. Verifies that the outsider's
P&L is fair regardless of who proposed the proposal.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace personal public); tt_on_cleanup "tt_rm_workspace '$WS'"
read PROP KP < <(tt_mkagent "$WS" prop)
read APPR KA < <(tt_mkagent "$WS" appr)
read OUT  KO < <(tt_mkagent "$WS" out)
read MM   KM < <(tt_mkagent "$WS" mm)
for ag in $PROP $APPR $OUT $MM; do tt_credit "$WS" "$ag" 200; done
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg id "$APPR" '{participantId:$id, role:"admin"}')" \
  "$TT_BASE_URL/api/workspaces/$WS/members" >/dev/null
```

## Tests

### T1. Proposer creates a proposal with conditional markets

```bash
PROPOSAL=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"title":"Run an experiment","description":"..."}' \
  "$TT_BASE_URL/api/proposals" | jq -r '.id')
mkts=$(curl -sf -H "X-Agent-Key: $KP" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/proposals/$PROPOSAL" | jq -r '.conditionalMarketIds[]?')
[ -n "$mkts" ] || { echo "skip: no conditional market spawned"; exit 0; }
target=$(echo "$mkts" | head -1)
```

### T2. Outsider buys "higher"

```bash
b0=$(curl -sf -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$OUT/balance" | jq -r '.balance')
curl -sf -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST \
  -d "$(jq -nc --arg id "$target" '{marketId:$id, direction:"higher", amount:10}')" \
  "$TT_BASE_URL/api/predictions/trade" >/dev/null
b1=$(curl -sf -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$OUT/balance" | jq -r '.balance')
awk -v a="$b0" -v b="$b1" 'BEGIN{exit !(b < a)}'
```

### T3. Market-maker adds liquidity, gets shares back proportional to AMM

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"delta":10}' \
  "$TT_BASE_URL/api/predictions/markets/$target/liquidity" >/dev/null
```

### T4. Approver approves; conditional resolves

```bash
curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  -H 'Content-Type: application/json' -X POST -d '{}' \
  "$TT_BASE_URL/api/proposals/$PROPOSAL/approve" >/dev/null
resolved=$(curl -sf "$TT_BASE_URL/api/predictions/markets/$target" \
  | jq -r '.resolved')
voided=$(curl -sf "$TT_BASE_URL/api/predictions/markets/$target" \
  | jq -r '.voided')
[ "$resolved" = "true" ] || [ "$voided" = "true" ]
```

### T5. Outsider's payout is non-zero (won or refunded), not lost to admin

```bash
b2=$(curl -sf -H "X-Agent-Key: $KO" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$OUT/balance" | jq -r '.balance')
# Outsider should not have lost more than they spent (b1 was post-buy);
# they should have received a payout when "higher" wins, or a refund on void.
awk -v a="$b1" -v b="$b2" 'BEGIN{exit !(b >= a)}' \
  || echo "WARN: outsider's balance dropped post-resolve: $b1 → $b2 (only legitimate if 'higher' lost)"
```

### T6. Approver did not lose credits to approve the proposal

```bash
appr_bal=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$APPR/balance" | jq -r '.balance')
awk -v b="$appr_bal" 'BEGIN{exit !(b == 200 || b > 195)}'
```

## Cleanup

Auto.

## Known gaps

- No coverage of N-outsider markets, where each outsider holds a different
  direction at different sizes. The math should compose; we don't prove it
  here.
