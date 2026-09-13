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

or, on the sell side:

> Sell up to `shares` of the `direction` position held in market `M`, but
> only while the market's consensus is at or beyond `limitValue` in that
> position's favour.

Fields (`limit_orders`):

| field | meaning |
|---|---|
| `id`, `workspaceId`, `marketId`, `agentId` | scope and owner |
| `side` | `buy` \| `sell`; `buy` when omitted, so every order placed before sells existed is a buy |
| `direction` | `higher` \| `lower`: the side bought, or the held position sold |
| `limitValue` | metric-space value, not probability: the page speaks dollars, so the order does too |
| `budgetCredits` | buy: total credits committed, decremented as fills happen. sell: 0 |
| `filledCredits` | buy: credits spent so far. sell: proceeds received so far |
| `shares` | sell: shares to sell. buy: null |
| `filledShares` | sell: shares sold so far. buy: null |
| `status` | `open` \| `filled` \| `cancelled` \| `expired` \| `voided` (the market was voided; remainder refunded) |
| `expiresAt` | nullable; an order with no expiry rests until cancelled |
| `createdAt`, `updatedAt` | |

**Direction and limit read together**: a `higher` buy with `limitValue`
$65k means "buy higher while consensus is at or below $65k" (the market is
cheaper than I think it should be). A `lower` buy with $80k means "buy
lower while consensus is at or above $80k". A `higher` sell with $80k means
"sell my higher shares while consensus is at or above $80k", and a `lower`
sell with $50k "sell my lower shares while consensus is at or below $50k":
a sell waits for the price its position wants. The UI must state this in
words, because sign errors here cost real credits.

## Funds are reserved, not merely promised

The failure this design exists to prevent: an order resting for a week
against a balance the trader has since spent elsewhere, filling into a
negative balance or silently failing at the worst moment.

So `budgetCredits` is **debited at placement** into a reservation, exactly
like the proposal listing stake. Cancelling or expiring refunds the
unfilled remainder. Balance shown in the ticket is spendable balance, i.e.
net of open reservations, or the number lies.

**A sell reserves nothing, and never sells more than is held.** Its shares
stay in the position, which keeps settlement, payouts and every board
reading positions exactly as they are. Instead two checks hold the rule:

- Placement refuses `shares` beyond the position minus the shares still
  waiting in the same participant's other open sells on that side and market
  (400 `insufficient_shares`, with `available`).
- Each fill sells at most the shares held at that moment. Selling by hand
  therefore shrinks what a sell order can sell, and an order whose position
  is gone closes as `cancelled`.

A sell only ever sells, so it can never flip a holder to the other side.

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
3. For each buy, buy in its direction with the smaller of its remaining
   budget and the amount that would move consensus back to its `limitValue`.
   For each sell, sell the smallest of its remaining shares, the shares held
   now, and the amount that would move consensus back to its `limitValue`.
   An order never moves the price past its own limit, which is what makes it
   a limit order rather than a delayed market order.
4. Stop when the price no longer crosses any order.

**Opposing orders are matched, not traded back and forth.** Two orders
pulling the price opposite ways whose limits overlap (a higher buy under 56
and a lower buy over 45, of one participant or of two) are both crossed at
every price between, and each fill crosses the other again: filled one step
at a time they would alternate across the band until one of them ran out. The
pass computes that end instead of walking to it. Once it has seen the same two
orders make one full round and the price come back exactly where it was,
every further round is identical, so it books all the whole rounds both
orders can still afford at once, one trade per order at exactly what those
rounds cost, both stamped with one instant and leaving the price where it
stands; then it fills what is left normally. Where the price ends, what each
order spent or sold, and what each participant holds are what trading back
and forth to the end would have produced, without the rows or the time.

Nothing is refused for it. One participant's two opposing orders are placed
like any others, and the higher and lower shares they buy from each other
redeem at par as they are bought (docs/ui-conventions.md, "A trader holds
ONE net side"), so they net out.

**An order placed past the market fills at once.** A limit the market has
already reached is not refused: placement runs the same trade a fill would (a
buy toward its limit with its budget, a sell of its shares bounded by its
limit), then the fill pass for other orders that move crossed, and rests what
is left, all in one transaction. A buy reserves only the remainder. Refusing
these orders left a trader a market order that could run past their price, or
nothing.

Fills are ordinary trades: same position rows, same
`replayMarketTradePoints` history, so the chart shows them like any other
step. This is enforced structurally rather than by discipline: there is one
`executeTradeInTx` in `services/trading.ts`, and both the trade route and the
fill pass call it.

Three properties the implementation must keep, because losing any of them
turns a limit order into something else:

- **A stranger's order can never fail your trade.** Each fill runs in its own
  savepoint inside the triggering trade's transaction. An order that cannot
  fill right now (no cap headroom, agent gone, amount rounds to nothing)
  unwinds to that savepoint and is left resting; the trade that triggered the
  pass, and every fill before it, still stand.
- **A fill spends reserved credits, not fresh balance.** The reservation is
  released to the participant's balance immediately before the fill and the
  unused part is re-reserved after it, so a fill leaves spendable balance
  untouched and cannot overdraw.
- **The market is locked before its orders.** Every path that touches a
  market's resting orders (a trade, a placement, the sweep, a void, a
  resolution, a decision) takes the market row's lock first and the orders'
  locks after it. Taken in the other order, the sweep filling a book and a
  decision voiding the same book each wait for the other, Postgres kills one
  as a deadlock, and the decision fails.

A market that resolves or is voided refunds every resting order's remainder,
so credits are never stranded in a market that can no longer trade.

The AMM is the counterparty to every fill, so no anti-wash rule is needed;
the existing cap and the charter's coordination rule still govern.

## API

- `POST /api/predictions/limit-orders`: a buy is `{ marketId, direction, limitValue, budgetCredits, expiresAt? }` (`side: "buy"` optional); it debits the budget and returns the order. A sell is `{ marketId, side: "sell", direction, limitValue, shares, expiresAt? }`; it moves nothing and returns the order. An order whose limit the market has already reached fills at once, up to its limit and never past it, and whatever is left rests (below, "An order placed past the market fills at once"). The response then carries `filledNow` (`cost` on a buy or `proceeds` on a sell, `shares`, `consensus`), and an order with nothing left comes back `filled`. 400 `insufficient_shares` for a sell beyond what is held.
- `GET /api/predictions/limit-orders?marketId=&status=`: the caller's own orders; admins may pass `agentId`. `status` defaults to `open`; `status=all` returns every state. Every row carries `side`; a sell also carries `shares`, `filledShares` and `remainingShares`.
- `DELETE /api/predictions/limit-orders/:id`: cancel, refunding the unfilled remainder (always 0 for a sell). Owner or admin only.

A buy placed without `side` behaves and answers exactly as before sells
existed; the new fields are additions.

Every open book takes limit orders, in the API and in the ticket alike,
however soon its trading closes.

A trade's own `limit` (docs/guides/agent-api.md, "Guard the price") is not a
limit order. It fills now, up to its bound, and hands back what it did not
spend; nothing rests and nothing is reserved. The fill pass above is the same
whether or not the trade that triggered it carried one.

All three appear in `/api/help` and in telarchy-skill, per the parity rule:
anything the UI can do, an API key can do.

## UI

Inside the ticket, which stays one object (see `ui-conventions.md`). The
ticket already asks two questions, side and amount; limit adds a third that
is optional and hidden until wanted:

- A `Quick` / `Limit` toggle in the ticket's header, Manifold-style, on
  both tabs: on Buy once a side is picked, on Sell once there is a position
  to sell. Default is `Quick`, so the common case gains nothing to read.
- **`Limit` is offered on every book**, a one-minute snake proposal
  included; nothing about a book's close hides it.
- Choosing `Limit` reveals one mono input in metric space, prefilled
  with the current call, and the confirm restates the instruction:
  **"Buy Higher under $65,000"**. The stake is already on screen in the
  composer, so the confirm names the side and the price and stays one line in
  the 293px rail. It never says "place order" alone; an instruction the
  trader cannot read back is an instruction they did not give.
- Choosing `Limit` prefills a legal limit just inside the current call
  on the side that rests, so the field opens with an answer rather than an
  error to clear. A limit the market has already passed is not refused: one warning line under it says what fills now ("The market is already under $60,000: 12.4 cr fills now"; on a sell, "12 of 40 shares sell now"), and the confirm places it. A limit outside the market's range is refused in the ticket, before it is sent.
- A composed limit order casts no ghost on the chart, because it moves no price today. The ghost is reserved for what a confirm would do immediately, so a limit the market has already passed casts the ghost of the fill it makes now.
- **A sell limit** is the Sell tab in `Limit` mode: the held position's row
  with its shares slider (all of it by default, never more), the price input,
  one line saying what the pair means ("sell at this or higher" for a
  higher position, "sell at this or lower" for a lower one; short enough to
  stay one line in the ticket), what is being sold
  and what it brings ("You get N cr or more", the shares at the limit price,
  since every share of a fill sells at the limit or better), and an ink
  confirm that restates the instruction: **"Sell 166.4 at $80,000"**. A limit the market has already passed warns and fills at once, as on Buy.
- The ticket never states when an order is released. That it rests until it
  fills, is cancelled, or its book closes is understood without saying.
- Resting orders list under the ticket as one quiet line each, in the same
  register as a held position, naming the verb: "buy under $65,000 · 25 cr",
  "buy over $80,000 · 25 cr", "sell at $80,000 · 166.4 sh", each with a
  Cancel, the only thing a resting order can have done to it. Filled and
  cancelled orders do not linger; they are in the activity rail.
- The chart draws the viewer's own resting orders as faint horizontal rules
  at their limits, in the direction's colour, labelled with the verb
  ("▲ buy 65,000", "▲ sell 80,000"): seeing your order sitting in the price
  makes the abstraction concrete, and it costs one line per order.

## What this deliberately does not do

No order book depth chart, no partial-fill notifications, no
good-till-date presets beyond a plain expiry, no stop orders. Those are
exchange features for markets with counterparties; here they would be
chrome on an AMM.
