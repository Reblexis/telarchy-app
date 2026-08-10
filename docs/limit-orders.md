# Limit orders

**Status: specified, not built (2026-08-10).** Owner asked for limit orders
on the trading floor. This is the design; the code conforms to it, not the
other way round.

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

That is also the honest answer to the position cap: a 250 cr cap bounds how
far one account can move the price at once, and limit orders let the same
conviction be expressed over time instead of in one shove.

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
| `status` | `open` \| `filled` \| `cancelled` \| `expired` |
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

No matching engine and no cron loop. **Every trade in a market triggers a
fill pass on that market**, inside the same transaction that moved the
price:

1. The trade executes and moves consensus from `c0` to `c1`.
2. Load open orders on that market whose `limitValue` lies in `[c0, c1]`
   (the range the price just crossed), ordered by how far they are from
   `c1`, so the ones the price passed first fill first.
3. For each, buy in its direction with the smaller of its remaining budget
   and the amount that would move consensus back to its `limitValue`. An
   order never moves the price past its own limit, which is what makes it a
   limit order rather than a delayed market order.
4. Stop when the price no longer crosses any order.

Fills are ordinary trades: same position rows, same cap accounting, same
`replayMarketTradePoints` history, so the chart shows them like any other
step. **The per-account position cap applies to the total of filled credits
plus open reservations**, or an account could exceed the cap by resting
orders it knows will fill.

Self-trading is impossible by construction (the AMM is the counterparty),
so no anti-wash rule is needed; the existing cap and the charter's
coordination rule still govern.

## API

- `POST /api/predictions/limit-orders` — body `{ marketId, direction, limitValue, budgetCredits, expiresAt? }`. Debits the budget, returns the order. 400 if `limitValue` is already crossed (that is a market order; say so rather than filling instantly and surprising the trader).
- `GET /api/predictions/limit-orders?marketId=&status=` — the caller's own orders; admins may pass `agentId`.
- `DELETE /api/predictions/limit-orders/:id` — cancel, refunding the unfilled remainder. Owner or admin only.

All three appear in `/api/help` and in telarchy-skill, per the parity rule:
anything the UI can do, an API key can do.

## UI

Inside the ticket, which stays one object (see `ui-conventions.md`). The
ticket already asks two questions, side and amount; limit adds a third that
is optional and hidden until wanted:

- A quiet `at any price` / `at my price` toggle under the side pair. Default
  is `at any price`, i.e. today's behaviour, so the common case gains
  nothing to read.
- Choosing `at my price` reveals one mono input in metric space, prefilled
  with the current call, and the confirm restates the whole instruction:
  **"Buy higher with 25 cr while under $65,000"**. The confirm never says
  "place order" alone; an instruction the trader cannot read back is an
  instruction they did not give.
- Resting orders list under the ticket as one quiet line each, in the same
  register as a held position: direction, limit, remaining budget, and a
  cancel. Filled and cancelled orders do not linger; they are in the
  activity rail.
- The chart draws each resting order as a faint horizontal rule at its
  limit, in the direction's colour. This is the Manifold lesson worth
  taking: seeing your order sitting in the price makes the abstraction
  concrete, and it costs one line per order. Above a handful of orders,
  draw the trader's own only.

## What this deliberately does not do

No order book depth chart, no partial-fill notifications, no
good-till-date presets beyond a plain expiry, no stop orders. Those are
exchange features for markets with counterparties; here they would be
chrome on an AMM.
