---
id: 04-markets-browse-and-trade
tags: [browse, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a participant with credits, I can browse the markets list, drill into
  a market, place a directional or value-target trade, and see the
  consensus + my balance update accordingly.
---

# Browse test: Markets list and trading panel

## What this tests

The `/markets` page (browse, filter, drill into a market) and the in-page
trading panel (place a directional trade or value-target trade, observe
consensus move, see updated balance + position). This is the core loop that
section 4 of `mvp-evaluation-plan.md` covers; this spec exercises the UI side
of those mechanics.

## Preconditions

- An authenticated user with the `trade` capability in the active workspace.
- The active workspace has at least one open market with `liquidity > 0`. If
  not, `POST /api/predictions/markets/refresh` to seed.
- The user has a non-zero balance (top up via deposit or admin credit if
  needed).

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/markets"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-markets-baseline.png"
```

## Tests

### T1. Markets list renders open markets, sorted by earliest target

**Steps:**
1. `$B text` the markets list.
2. Pull ground truth: `curl -s -b <cookie> https://telarchy.com/api/predictions/markets | jq -r '.[] | "\(.targetDate)|\(.metricName)"' | sort`.

**Expected:**
- Every API row appears in the page (or at least the first page of results).
- UI ordering matches API default (earliest `targetDate` first).

### T2. Filter input narrows the list

**Steps:**
1. `$B snapshot -i` and find the filter input.
2. `$B fill <ref> "<a metric name>"`
3. `$B text` and verify only matching market cards are visible.

**Expected:** Visible market count equals the count of matching API rows.

### T3. Click a market card → trading panel opens

**Steps:**
1. `$B snapshot -i` and find a market card.
2. `$B click <ref>`
3. `$B is visible ".trading-panel, [data-testid='trading-panel']"`.
4. `$B screenshot /tmp/markets-detail.png`.

**Expected:**
- Panel shows current consensus, range, range slider / probability slider.
- "Buy higher" / "Buy lower" buttons are visible.
- A "history" or "trades" subsection is present.

### T4. Directional trade moves consensus the right way

**Steps:**
1. Capture the consensus value: `$B text | grep -i consensus`.
2. Capture balance from the sidebar.
3. `$B fill <amount-ref> "1.0"`
4. `$B click <buy-higher-ref>`
5. `$B wait --networkidle`
6. Re-read consensus and balance.

**Expected:**
- Consensus increased (within LMSR rounding).
- Balance decreased by the trade `cost`.
- A toast or inline message confirms the trade.
- A new row appears in the trades subsection.
- `$B console --errors` is empty.

### T5. Insufficient balance produces a clean error

**Steps:**
1. Try to spend an amount exceeding current balance.
2. `$B text` after submit.

**Expected:** Inline error referencing balance; no trade recorded
(verify by re-reading the balance).

### T6. Position panel reflects the trade

**Steps:**
1. After T4, navigate to the user's positions panel (sidebar or `/account`).
2. `$B text` and find the market just traded.

**Expected:** Shares for the right direction, totalCost matching `cost` from T4.

### T7. Sell shares refunds proportional credits

**Steps:**
1. From the position panel or trading panel, choose "sell" with a small
   share count.
2. Confirm.
3. Re-read balance.

**Expected:** Balance increased by the proceeds (less LMSR spread).

## Cleanup

Trades are recorded; you can leave them or `psql` to reverse the row +
restore the AMM state. For repeatable runs, prefer using a dedicated test
workspace seeded fresh each time over editing the production AMM.

## Known gaps

- No coverage of the LMSR `targetValue + maxBudget` mode. Add once a UI
  affordance for it lands (today only the directional and "buy until value"
  flows are wired in the trading panel).
- No coverage of conditional markets (linked to tasks). Use
  `tasks-flow.md` for that surface.
- No assertion on chart-update latency; `mvp-evaluation-plan.md` 4.10 wants
  consensus to refresh within 2s. Add timing once `$B perf` integration is
  wired into the spec.
