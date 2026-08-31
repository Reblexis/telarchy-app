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

If the price is already on your side when you place it, that is a market order,
and the API says so with a 400 rather than filling something you did not ask
for. Place a trade instead.

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
