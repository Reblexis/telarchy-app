---
id: 04-markets-limit-orders
tags: [browse, api]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a trader who thinks the market is wrong but does not want to pay the
  average price across the whole move, I can rest an order at my own price,
  see it sitting in the chart, have it fill when someone pushes the price
  into it, and cancel it to get my unspent credits back.
---

# Browse test: limit orders on the trading floor

## What this tests

The `Quick` / `Limit` toggle in the trade ticket, the resting
order line under it, the faint rule the chart draws at the limit, and the
three endpoints behind them (`POST` / `GET` / `DELETE
/api/predictions/limit-orders`). Design and invariants: `docs/limit-orders.md`.

The properties worth failing the build over are money properties, not visual
ones: the budget leaves the balance at placement, a fill spends that reserved
money rather than fresh balance, and cancelling gives back exactly what was
never spent.

## Preconditions

- An authenticated user with `trade` in the active workspace, holding at
  least 200 credits.
- One open market with `liquidity > 0`, reachable at its public slug.
- A second participant (agent key) able to trade the same market, to push the
  price into the resting order.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/$TT_WS_SLUG"
$B wait --networkidle
```

Record the starting call and balance:

```bash
CALL=$(curl -s "$TT_API/marketplace/$TT_WS_SLUG" | jq -r '.markets[0].consensus')
MARKET=$(curl -s "$TT_API/marketplace/$TT_WS_SLUG" | jq -r '.markets[0].marketId')
BAL0=$(curl -s -b "$TT_COOKIE" "$TT_API/agents/me" | jq -r '.balance')
```

## Tests

### T1. The ticket asks nothing about price until a side is picked

**Steps:**
1. `$B text` the ticket region.

**Expect:** `Lower` and `Higher` are present; `Quick` and `Limit` are NOT.
Picking a side grows the card: the boxed amount with steppers and slider, the
Quick/Limit toggle top right, the `New value` and `To win` rows, and a
confirm reading `Buy HIGHER to win <payout> cr`.

### T2. Limit mode opens with a legal limit, not an error

**Steps:**
1. `$B click` `Higher`, then `$B click` `Limit`.
2. `$B text` the limit field.

**Expect:** the field is prefilled just BELOW the current call (a `higher`
order rests under the price), no error hint is shown, and the confirm reads
the full instruction: `Buy Higher with 25 cr under $<value>`.

### T3. A limit on the wrong side of the call is refused before it is sent

**Steps:**
1. Type a limit ABOVE the current call.

**Expect:** the hint reads `Below $<call>, or it fills right now`, the confirm
falls back to `Set a price for Higher` and is disabled, and no request is made
(check the network log, or that `GET /limit-orders` still returns the same
count).

### T4. Placing reserves the money and draws the order in the chart

**Steps:**
1. Set the limit to roughly 80% of the current call, amount 25, confirm.
2. `$B screenshot` the chart.
3. `curl -s -b "$TT_COOKIE" "$TT_API/predictions/limit-orders?marketId=$MARKET"`

**Expect:**
- The confirm flashes `✓ Order resting`.
- A row appears under the ticket: `▲ higher · under $<limit> · 25.0 cr waiting`.
- The chart shows a faint dashed rule at the limit, labelled `▲ your order`.
- The API returns one open order with `remainingCredits: 25`.
- Balance is now `BAL0 - 25`: the budget is debited at placement, not on fill.

### T5. Someone else's trade fills the order, and the fill stops at the limit

**Steps:**
1. As the second participant, push the price well past the limit:
   `POST /api/predictions/trade {"marketId":"$MARKET","targetValue":<far below the limit>,"maxBudget":100}`.
2. Read the response and re-read the market.

**Expect:**
- The trade returns 201 and carries `limitFills` plus `settledConsensus`.
- The market's consensus comes to rest AT the limit, not below it: the order
  bought back up to its own price and stopped.
- The order's `filledCredits > 0`. If it did not exhaust its budget it is
  still `open`, resting at the same limit with the remainder.
- The resting trader's spendable balance is UNCHANGED by the fill (the money
  was already reserved). Their position in the market has grown.

### T6. Cancelling refunds exactly the unspent remainder

**Steps:**
1. `$B click` `Cancel` on the resting row (or `DELETE /limit-orders/:id`).
2. Re-read balance and orders.

**Expect:** the response carries `refundedCredits` equal to
`budgetCredits - filledCredits`; the balance rises by that amount and no more;
the row disappears from the ticket and the rule disappears from the chart;
a second cancel returns 400.

### T7. Reserved credits count against the position cap

**Steps:**
1. With `maxPositionCostPerMarket` set (default 250 on the public floor),
   rest an order for most of the cap, then try to buy the rest by hand.

**Expect:** 400 with `Position cap reached`, and `spent` in the body INCLUDES
the reserved credits. Otherwise resting orders would be a way around the cap.

### T8. Resolution does not strand reserved money

**Steps:**
1. Rest an order, then resolve or void the market as admin.
2. Read the balance and the order.

**Expect:** the order's status is `cancelled` (resolution) or `voided`, and
the remainder is back in the balance.

## Known gaps

- Expiry is swept lazily (on list and on any fill pass), so an order whose
  `expiresAt` has passed can sit in the table as `open` until something looks
  at that market. It is never fillable in that window; the sweep runs before
  the fill. Not covered here because it needs a clock jump.
- The chart draws every one of the viewer's own resting orders. Above a
  handful this will crowd; no cap is implemented yet.
- Anonymous visitors see the price question in the demo ticket, but the
  confirm routes to signup, so there is no anonymous limit-order path to test.
