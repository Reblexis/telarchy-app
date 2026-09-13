---
title: Limit orders
description: Leave an order resting at a price in the metric's own units, and let it fill without you watching.
category: forecast
order: 40
---
# Limit orders

A limit order is a standing instruction: buy this side of this market, with up
to this budget, but only while the price is on your side of a number you name.
It exists so you do not have to sit on the market waiting for a price you would
take.

```
POST /api/predictions/limit-orders
{ "marketId": "...", "direction": "higher", "limitValue": 38000,
  "budgetCredits": 400, "expiresAt": "2026-09-15T00:00:00Z" }
```

**`limitValue` is in the metric's own units, not a probability.** A `higher`
order fills while the consensus is at or **below** its limit; a `lower` order
fills while it is at or **above**. The example above says: buy higher while the
market is priced at $38,000 or less.

If the price is already on your side when you place it, the order fills at once,
up to your limit and never past it, and whatever is left rests. The response's
`filledNow` says what filled (`cost` or `proceeds`, `shares`, `consensus`); an
order with nothing left comes back `filled`.

## Selling at your price

A sell order is the same instruction for shares you already hold: sell this
many of my position, but only while the price is where I want it.

```
POST /api/predictions/limit-orders
{ "marketId": "...", "side": "sell", "direction": "higher",
  "limitValue": 80000, "shares": 166.4 }
```

`direction` names the position you are selling. A `higher` sell fills while the
consensus is at or **above** its limit, a `lower` sell while it is at or
**below**: each waits for the price its position wants. Leave `side` out and
the order is a buy, exactly as before.

A sell never sells more than you hold. Placing one refuses `shares` beyond your
position minus what your other open sells on that side are still waiting to
sell (400 `insufficient_shares`, with `available`). Nothing is set aside: the
shares stay in your position and settle like any others until a fill sells
them. If you sell some by hand meanwhile, the order can sell only what is left,
and once the position is gone the order closes as `cancelled`. A sell only
sells, so it can never turn you into a holder of the other side.

## Your own orders never trade against each other

A higher buy and a lower sell push the price up when they fill; a lower buy
and a higher sell push it down. If you already rest an order pushing one way,
an order of yours pushing the other way on the same market must have its limit
on the far side: the up-pusher's limit may not be above the down-pusher's.
Otherwise both are crossed at every price between the two limits and you
would buy both sides back and forth. Such an order is refused with 409
`crosses_own_order`, carrying the resting order's `orderId`; nothing is
reserved and nothing trades. Cancel the resting order first if you meant to
replace it.

## The budget is taken up front

The credits are debited when you place the order and held in reserve. Your
spendable balance is net of them. Cancel, expire, void or resolve and the
unfilled remainder comes back.

This is the part that catches people out: a resting order is money you have
already committed, not an intention.

## How they fill

There is no matching engine and no polling. Two things run the fill pass:

- Every trade in a market runs it inside that trade's own transaction, so an
  order crossed by somebody else's buy fills immediately, not eventually.
- A sweep runs across every market with open orders every twelve seconds, which
  catches the cases nobody traded into: a liquidity injection, a resolution, a
  price that moved for any other reason.

Each fill buys toward its own limit and no further. Orders are filled deepest
first, by how far the price passed each limit. A fill is an ordinary trade: same
position, same cap accounting, same trade record.

Two guarantees worth knowing. A stranger's failing order can never fail your
trade, because each fill runs in its own savepoint. And a fill spends the
reservation you already made, never fresh balance you were using for something
else.

## Managing them

```
GET    /api/predictions/limit-orders?status=open
DELETE /api/predictions/limit-orders/:id
```

`status` accepts `open`, `filled`, `cancelled`, `expired` or `all`, and defaults
to open. Each row carries what is left of its budget. Cancelling returns the
unfilled remainder and tells you how much came back.

`expiresAt` is optional and must be in the future. Expired orders are swept
whenever the list is read or a fill pass runs.

## What does not exist

No order book depth, no stop orders, no partial-fill notifications, no
good-till-date presets beyond a plain expiry. If you want to know your order
filled, read your positions or your trades.
