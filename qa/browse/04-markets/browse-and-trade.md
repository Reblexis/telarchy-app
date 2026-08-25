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

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Markets list and trading panel

## What this tests

The `/markets` page (browse, filter, drill into a market) and the in-page
trading panel (place a directional trade or value-target trade, observe
consensus move, see updated balance + position). This is the core loop that
section 4 of `mvp-evaluation/plan.md` covers; this spec exercises the UI side
of those mechanics.

## Preconditions

- An authenticated user with the `trade` capability in the active workspace.
- The active workspace has at least one open market with `liquidity > 0`. If
  not, `POST /api/predictions/markets/refresh` to seed.
- The user has a non-zero balance (top up via deposit or admin credit if
  needed).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
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
3. `$B is visible ".trade-panel"` (the expanded card's order surface).
4. `$B screenshot /tmp/markets-detail.png`.

**Expected:**
- Panel shows current consensus, range, range slider / probability slider.
- Under a "Place a trade" label: an "Amount to spend" `$` field and two
  direction buttons `.trade-dir-lower` ("▼ Lower") / `.trade-dir-higher`
  ("▲ Higher"), each with a preview caption.
- The "PREDICTION HISTORY" (trades) subsection is present.

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

### T8. Bet toward a value moves consensus to the target

**Steps:**
1. In the expanded trading panel, under the "or aim for a value" label, find
   the "Target value" input, the "Max budget" `$` field, and the
   `button.trade-toward-btn` ("Bet toward").
2. Capture the current consensus.
3. `$B fill <target-ref>` with a value on the far side of the range from the
   current consensus (e.g. `800` when consensus is ~500 on a 0..1000 market).
4. `$B fill <budget-ref> "5.0"` (generous budget so the target is reachable).
5. Confirm the preview hint shows a direction arrow, an approximate share
   count, and a projected consensus near the target.
6. `$B click <bet-toward-ref>` then `$B wait --networkidle`.

**Expected:**
- Consensus moved toward the target value (reaching it if budget allowed,
  otherwise moving as far as the budget permits).
- Balance decreased by at most the max budget.
- The result banner names the direction the server chose.
- `$B console --errors` is empty.

### T9. Order stays fixed after a trade

**Steps:**
1. `$B text` the markets list and record the metric-name order (default sort:
   earliest target date).
2. Place any trade (T4 or T8) on a market that is not first in the list.
3. `$B wait --networkidle` (the list re-fetches after a trade).
4. `$B text` the list again and record the order.

**Expected:** The order is identical before and after (same-target-date rows
keep a stable order tie-broken by market id; the traded market does not jump).
Caveat: when the active sort is "Prediction", the traded market legitimately
moves because its consensus changed; this test uses the default target-date
sort.

### T10. Metric name shows the metric description on hover

**Steps:**
1. `$B snapshot -i` and locate a `.market-metric-name` span whose metric has a
   non-empty description (check via `curl .../api/status | jq '.metrics'`).
2. Assert its `title` attribute equals the metric's description.

**Expected:** Hovering the metric name surfaces the metric's specified
description as a native tooltip. Metrics with an empty description have no
`title`.

### T11. `?metric=<id>&target=` scopes to the metric's subtree, not the whole date

This is where a click on a metric's forecast chart (MetricCard) lands: it
pairs the clicked metric's id with the clicked point's date so the list shows
that metric's own market (leaf) or its child markets (composite), never every
market that happens to share the target date.

**Steps:**
1. Pull metrics: `curl -s -b <cookie> https://telarchy.com/api/status | jq '.metrics'`.
   Pick a composite metric `C` (non-empty `formula`, not `"0"`) and a target
   date `D` at which several *unrelated* metrics also have markets.
2. `$B goto "$TT_FRONTEND_URL/markets?target=$D"` and count
   `.market-metric-name` rows (the unscoped baseline: all metrics at `D`).
3. `$B goto "$TT_FRONTEND_URL/markets?metric=<C.id>&target=$D"` and count again.

**Expected:**
- A "Showing markets under `<C.name>`" filter chip and a "Target: `D`" chip
  are both present.
- Every visible row's metric is `C` itself or a transitive child of `C`
  (cross-check against `getLeafDescendantIds` semantics: the leaf metrics whose
  formulas roll up into `C`). No unrelated metric from the date-only view
  survives.
- Scoping by a *leaf* metric id yields exactly that one metric's row; scoping
  by a composite in a disjoint subtree yields zero rows at `D`.
- `$B console --errors` is empty.

## Cleanup

Trades are recorded; you can leave them or `psql` to reverse the row +
restore the AMM state. For repeatable runs, prefer using a dedicated test
workspace seeded fresh each time over editing the production AMM.

## Known gaps

- No coverage of conditional markets (linked to proposals). Use
  `proposals-flow.md` for that surface.
- No assertion on chart-update latency; `mvp-evaluation/plan.md` 4.10 wants
  consensus to refresh within 2s. Add timing once `$B perf` integration is
  wired into the spec.
