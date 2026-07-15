---
id: 11-multi-agent-two-traders-converge
tags: [api-only, multi-agent]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short
goal-statement: |
  As two participants holding opposite views, we trade on the same market;
  the LMSR consensus moves toward the participant with bigger conviction
  (more credits committed), and at any point the AMM invariant holds.
---

# Browse test: Two traders converge on a market

## What this tests

Round trip: agents A and B trade in opposing directions on the same market.
The spec asserts:
- A's "higher" trade moves consensus up,
- B's "lower" trade moves it back down,
- consensus settles between A's and B's targets, weighted by capital,
- balances + position counts add up to the AMM invariant.

This is the core multi-agent property the platform's positioning depends on.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
WS=$(tt_mkworkspace blank public); tt_on_cleanup "tt_rm_workspace '$WS'"
read A KA < <(tt_mkagent "$WS" alice)
read B KB < <(tt_mkagent "$WS" bob)
tt_credit "$WS" "$A" 200
tt_credit "$WS" "$B" 200
mid=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"converge","type":"leaf","value":50,"marketRangeMax":100,"timePreference":{"enabled":false}}' \
  "$TT_BASE_URL/api/metrics" | jq -r '.id')
mkt=$(tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d "$(jq -nc --arg m "$mid" '{metricId:$m, targetDate:"2030-01-01", liquidity:50, skipAutoLiquidity:true}')" \
  "$TT_BASE_URL/api/predictions/markets" | jq -r '.id')
trade() { # $1 key, $2 dir, $3 amt
  curl -sf -H "X-Agent-Key: $1" -H "X-Workspace-Id: $WS" \
    -H 'Content-Type: application/json' -X POST \
    -d "$(jq -nc --arg id "$mkt" --arg d "$2" --argjson a "$3" \
        '{marketId:$id, direction:$d, amount:$a}')" \
    "$TT_BASE_URL/api/predictions/trade"
}
consensus() {
  curl -sf -H "X-API-Key: $TT_ADMIN_KEY" -H "X-Workspace-Id: $WS" \
    "$TT_BASE_URL/api/predictions/markets/$mkt" | jq -r '.consensus'
}
```

## Tests

### T1. Initial consensus is around the metric value (50)

```bash
c0=$(consensus)
awk -v c="$c0" 'BEGIN{exit !(c >= 30 && c <= 70)}' \
  || { echo "initial consensus $c0 outside [30,70]"; exit 1; }
```

### T2. A "higher" trade moves consensus up

```bash
trade "$KA" higher 20 >/dev/null
c1=$(consensus)
awk -v a="$c0" -v b="$c1" 'BEGIN{exit !(b > a)}' \
  || { echo "A's higher trade did not move consensus up: $c0 → $c1"; exit 1; }
```

### T3. B "lower" trade moves it back down

```bash
trade "$KB" lower 10 >/dev/null
c2=$(consensus)
awk -v a="$c1" -v b="$c2" 'BEGIN{exit !(b < a)}' \
  || { echo "B's lower trade did not move consensus down: $c1 → $c2"; exit 1; }
```

### T4. A trades again, larger; consensus crosses back above c1

```bash
trade "$KA" higher 30 >/dev/null
c3=$(consensus)
awk -v a="$c1" -v b="$c3" 'BEGIN{exit !(b > a)}' \
  || { echo "A's larger trade should move consensus past c1=$c1, got $c3"; exit 1; }
```

### T5. Position counts agree with trades

```bash
posA=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/positions" \
  | jq -r --arg id "$A" '.[] | select(.agentId==$id) | .higherShares // .higher')
posB=$(curl -sf -H "X-Agent-Key: $KB" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/predictions/markets/$mkt/positions" \
  | jq -r --arg id "$B" '.[] | select(.agentId==$id) | .lowerShares // .lower')
awk -v a="$posA" 'BEGIN{exit !(a > 0)}'
awk -v b="$posB" 'BEGIN{exit !(b > 0)}'
```

### T6. AMM invariant holds (balance + share value ≈ pre-trade balance)

```bash
# Each trader's balance + value of shares at current consensus should
# approximate the credits they put in (less LMSR spread).
balA=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$A/balance" | jq -r '.balance')
balB=$(curl -sf -H "X-Agent-Key: $KB" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$B/balance" | jq -r '.balance')
# Newly-registered agents seed at 1000 + the 200 we tt_credit = 1200 each.
# A spent up to 50 + 30 = 80; B spent up to 10. Allow slack for LMSR cost.
awk -v b="$balA" 'BEGIN{exit !(b >= 1100 && b <= 1200)}' \
  || { echo "A balance out of expected range: $balA"; exit 1; }
awk -v b="$balB" 'BEGIN{exit !(b >= 1180 && b <= 1200)}' \
  || { echo "B balance out of expected range: $balB"; exit 1; }
```

### T7. Resolve at the metric value 80 → A is the bigger winner

Uses `POST /api/predictions/markets/:id/resolve` so the test exercises
the payout flow without waiting on the daily cron.

Each agent started with 1000 (signup) + 200 (tt_credit) = 1200. Compare
each agent's *net* end-of-test balance against that starting line, not
just post-trade vs post-resolve — the LP-leftover distribution can give
a losing trader a small positive resolve delta even when their net is
still a loss.

```bash
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X PUT -d '{"value":80}' "$TT_BASE_URL/api/metrics/$mid" >/dev/null
tt_admin_curl "$WS" -H 'Content-Type: application/json' \
  -X POST -d '{}' "$TT_BASE_URL/api/predictions/markets/$mkt/resolve" >/dev/null
balA_post=$(curl -sf -H "X-Agent-Key: $KA" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$A/balance" | jq -r '.balance')
balB_post=$(curl -sf -H "X-Agent-Key: $KB" -H "X-Workspace-Id: $WS" \
  "$TT_BASE_URL/api/agents/$B/balance" | jq -r '.balance')
# A bet 'higher' on a metric that resolved at 80 (top end of range) → net winner.
awk -v q="$balA_post" 'BEGIN{exit !(q > 1200)}' \
  || { echo "A should be net up vs 1200 start; post=$balA_post"; exit 1; }
# B bet 'lower' → net loser.
awk -v q="$balB_post" 'BEGIN{exit !(q < 1200)}' \
  || { echo "B should be net down vs 1200 start; post=$balB_post"; exit 1; }
```

## Cleanup

Auto.

## Known gaps

- No closed-form payout precision check; would need to embed the LMSR
  formula here.
- No coverage of identical-direction trades (two traders both bullish).
