# Limit orders

This is the design; the code conforms to it, not the other way round.
History: notes/decisions/limit-orders.md.

## Why they matter here more than on a normal exchange

Telarchy's markets are LMSR, so there is no order book and no counterparty:
every trade moves the price against a curve. That has one consequence that
makes limit orders more valuable here than the phrase suggests. **A thin
market cannot absorb conviction.** A trader who believes the LookPilot 2026
number is $60k, against a market at $73.6k, either takes the whole move
alone (paying the average price across it, which is worse than the price
they believe in) or does nothing. A resting order lets them say "I will buy
down to $65k and no further", and be filled by whoever pushes the price
into them later.

Nothing caps the size of a position, so a resting order is not a way around a
limit. It is a way to be paid a better average price for the same conviction:
the shove pays the whole move, the resting order is filled by whoever brings
the price to it.

## Model

A limit order is a standing instruction, not a matched trade:

> Buy `direction` in market `M` with up to `budget` credits, but only while
> the market's consensus is at or beyond `limitValue`.

Fields (`limit_orders`):

| field | meaning |
|---|---|
| `id`, `workspaceId`, `marketId`, `agentId` | scope and owner |
| `direction` | `higher` \| `lower` |
| `limitValue` | metric-space value, not probability: the page speaks dollars, so the order does too |
| `budgetCredits` | total credits committed, decremented as fills happen |
| `filledCredits` | how much has executed |
| `status` | `open` \| `filled` \| `cancelled` \| `expired` \| `voided` (the market was voided; remainder refunded) |
| `expiresAt` | nullable; an order with no expiry rests until cancelled |
| `createdAt`, `updatedAt` | |

**Direction and limit read together**: a `higher` order with `limitValue`
$65k means "buy higher while consensus is at or below $65k" (the market is
cheaper than I think it should be). A `lower` order with $80k means "buy
lower while consensus is at or above $80k". The UI must state this in words,
because sign errors here cost real credits.

## Funds are reserved, not merely promised

The failure this design exists to prevent: an order resting for a week
against a balance the trader has since spent elsewhere, filling into a
negative balance or silently failing at the worst moment.

So `budgetCredits` is **debited at placement** into a reservation, exactly
like the proposal listing stake. Cancelling or expiring refunds the
unfilled remainder. Balance shown in the ticket is spendable balance, i.e.
net of open reservations, or the number lies.

## Execution

No matching engine. **Every trade in a market triggers a fill pass on that
market**, inside the same transaction that moved the price, and an in-process
sweep runs the same pass on every open market every 12 seconds, so an order
crossed by a resolution, a liquidity change or a fill elsewhere does not wait
for the next trade:

1. The trade executes and moves consensus from `c0` to `c1`.
2. Load every open order on that market whose limit the current price has
   reached or passed, ordered by how far they are from the current price,
   so the ones the price passed first fill first.
3. For each, buy in its direction with the smaller of its remaining budget
   and the amount that would move consensus back to its `limitValue`. An
   order never moves the price past its own limit, which is what makes it a
   limit order rather than a delayed market order.
4. Stop when the price no longer crosses any order.

Fills are ordinary trades: same position rows, same
`replayMarketTradePoints` history, so the chart shows them like any other
step. This is enforced structurally rather than by discipline: there is one
`executeTradeInTx` in `services/trading.ts`, and both the trade route and the
fill pass call it.

Two properties the implementation must keep, because losing either turns a
limit order into something else:

- **A stranger's order can never fail your trade.** Each fill runs in its own
  savepoint inside the triggering trade's transaction. An order that cannot
  fill right now (no cap headroom, agent gone, amount rounds to nothing)
  unwinds to that savepoint and is left resting; the trade that triggered the
  pass, and every fill before it, still stand.
- **A fill spends reserved credits, not fresh balance.** The reservation is
  released to the participant's balance immediately before the fill and the
  unused part is re-reserved after it, so a fill leaves spendable balance
  untouched and cannot overdraw.

A market that resolves or is voided refunds every resting order's remainder,
so credits are never stranded in a market that can no longer trade.

Self-trading is impossible by construction (the AMM is the counterparty),
so no anti-wash rule is needed; the existing cap and the charter's
coordination rule still govern.

## API

- `POST /api/predictions/limit-orders`: body `{ marketId, direction, limitValue, budgetCredits, expiresAt? }`. Debits the budget, returns the order. 400 if `limitValue` is already crossed (that is a market order; say so rather than filling instantly and surprising the trader).
- `GET /api/predictions/limit-orders?marketId=&status=`: the caller's own orders; admins may pass `agentId`. `status` defaults to `open`; `status=all` returns every state.
- `DELETE /api/predictions/limit-orders/:id`: cancel, refunding the unfilled remainder. Owner or admin only.

All three appear in `/api/help` and in telarchy-skill, per the parity rule:
anything the UI can do, an API key can do.

## UI

Inside the ticket, which stays one object (see `ui-conventions.md`). The
ticket already asks two questions, side and amount; limit adds a third that
is optional and hidden until wanted:

- A `Quick` / `Limit` toggle in the ticket's header, Manifold-style,
  revealed once a side is picked. Default is `Quick`, i.e. today's
  behaviour, so the common case gains nothing to read.
- Choosing `Limit` reveals one mono input in metric space, prefilled
  with the current call, and the confirm restates the whole instruction:
  **"Buy Higher with 25 cr under $65,000"**. The confirm never says
  "place order" alone; an instruction the trader cannot read back is an
  instruction they did not give.
- Choosing `Limit` prefills a legal limit just inside the current call
  on the side that rests, so the field opens with an answer rather than an
  error to clear. A limit on the wrong side of the call is refused in the
  ticket, before it is sent, naming which side it belongs on.
- A composed limit order casts no ghost on the chart, because it moves no
  price today. The ghost is reserved for what a confirm would do immediately.
- Resting orders list under the ticket as one quiet line each, in the same
  register as a held position: direction, limit, remaining budget, and a
  cancel. Filled and cancelled orders do not linger; they are in the
  activity rail.
- The chart draws the viewer's own resting orders as faint horizontal rules
  at their limits, in the direction's colour: seeing your order sitting in
  the price makes the abstraction concrete, and it costs one line per order.

## What this deliberately does not do

No order book depth chart, no partial-fill notifications, no
good-till-date presets beyond a plain expiry, no stop orders. Those are
exchange features for markets with counterparties; here they would be
chrome on an AMM.
