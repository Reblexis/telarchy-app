---
title: How a market works, and how it pays you
description: Prices in the metric's own units, buying higher or lower, what settlement pays, and how to get out early.
category: forecast
order: 10
---
# How a market works, and how it pays you

Every market asks one question: where will this metric land on this date. The
price is the crowd's current answer, quoted in the metric's own units. If the
market says $41,200 and you think the month ends nearer $46,000, you buy
`higher` and you have taken a position against everyone who priced it lower.

## The price

Each market has a range, `rangeMin` to `rangeMax`, and holds two piles of
shares, `higher` and `lower`. An automated market maker is always your
counterparty, so there is no order book, no spread and nobody to match with.

The price you see, `consensus`, is `rangeMin` plus the higher-share fraction of
the range. The API also returns `probability`, which is that same fraction
between 0 and 1. It is easy to misread: `probability` is **where in the range
the crowd thinks the number lands**, not the chance of anything improving.

Buying moves the price toward you. How far depends on the market's liquidity
parameter, `b`: doubling the pool halves the price move per credit spent. Near
the middle of the range, spending X credits moves the price by roughly
`0.5 X / b`. A thin market moves a long way on very little, which is an
opportunity and a warning at once.

A market with no liquidity at all has no price. It renders, it refuses trades,
and the fix is for someone to fund it.

## Buying

`POST /api/predictions/trade`, identifying the market by `marketId`. There are
three shapes, and you use exactly one.

**Buy toward a value.** `{ marketId, targetValue, maxBudget }`. This is the one
to reach for. It buys until the price reaches your number or your budget runs
out, whichever comes first, so it cannot overshoot the value you actually
believe.

**Buy a direction with a budget.** `{ marketId, direction: "higher", amount }`.
Spends the whole budget, wherever that leaves the price.

**Sell.** `{ marketId, direction, sellShares }`. See below.

Two behaviours surprise people:

- **You hold one side, not both.** One `higher` share and one `lower` share pay
  exactly 1 credit between them whatever the number settles at, so a matched
  pair is certainty carrying no opinion. Buy the opposite side of a position you
  hold and the buy prices against the live book as normal, then every matched
  pair you are left holding is redeemed at that 1 credit and reported as
  `redeemed` on the trade. Redemption takes the same amount off both sides of
  the book, so it moves the price by nothing: a small contrarian bet stays a
  small move, and your position shrinks by what you bought. Nobody ends up
  holding both sides.
- **Nothing caps how much you buy.** One market takes as much of your balance
  as you want to put into it. The only ceilings are what you hold and what the
  book charges you: a big buy moves the price against itself, so the last
  share costs more than the first.

There are no fees.

## Settlement

A market resolves once its period has ended. The instant that matters is
`resolvesOn`, not the label on the market: a market for `2026-06` settles at
`2026-07-01T00:00:00Z`, one for `2026-W24` at midnight on the following Monday.

It settles on **the metric's last logged value at or before that instant**,
clamped to the range. This is worth being precise about, because it is the one
thing your money depends on. The resolver runs every ten minutes, so it usually
fires a little after the boundary, and that lateness changes nothing: a value
logged one second after the boundary belongs to the next period, not this one.

Payouts are proportional to where the number landed in the range. If the range
is 0 to 1000 and the number lands at 400, every `higher` share pays 0.4 credits
and every `lower` share pays 0.6. Credits arrive in the same transaction that
resolves the market.

A market is in one of four states, and each means something different for a
holder:

| State | What you can do |
|---|---|
| `open` | Buy and sell |
| `closed` | Sell only. It still settles on the real value at its date, so holding through it pays normally |
| `settling` | Its resolution instant has passed and the reading has not arrived yet. Nothing trades, in either direction; hold and it pays on the real value |
| `resolved` | Paid out. `actualValue` says what it settled on |
| `voided` | Cancelled. Everyone is refunded their net cash |

A void refunds **net cash**, not gross cost: buys minus sells, floored at zero.
Someone who traded in and out at a profit keeps the profit and gets no refund.
A void can never take credits off you.

Two things void a market rather than settling it. A metric that declares
`resolvesNaUntilMeasured` and has no reading yet resolves as not-applicable and
refunds everyone, instead of settling at a spurious zero. And an owner can void
deliberately, which is refused outright once anyone has traded unless they
acknowledge that and publish a reason of at least ten characters on the public
event log.

## Getting out early

You can sell any part of a position at any time while the market is `open` or
`closed`. `POST /api/predictions/trade` with
`{ marketId, direction, sellShares }`. The proceeds are what the market maker
will pay at the current price, credited immediately.

Selling is how you take a gain before the date arrives. It is also worth
knowing that the number the leaderboard shows for an open position is what it
would pay **if the market resolved right now at its current price**, which is
not the same as what a sale would fetch. The trading desk shows the real sale
value before you confirm.

Three limits: you cannot sell more shares than you hold, the proceeds must come
to more than nothing, and resolved, voided or `settling` markets are closed to
everything.

`settling` is why the third one matters. A market settles on the last reading
at or before its resolution instant, but a metric with a reporting lag is not
due for hours or days after that, and the reading is public in the meantime.
Trading through that window is buying a result you can already read, so it
stops at the resolution instant rather than at the payout
(`docs/market-integrity.md`, "Trading stops when the answer is fixed").

## Where to look

- `GET /api/predictions/markets` lists open markets. A public workspace answers
  this with no key at all: send `X-Workspace-Id` with the workspace id or slug
  and no credentials.
- `GET /api/predictions/markets/:id/context` is the whole story of one market in
  one read, including its price history.
- `GET /api/status` gives every metric with its markets and a trend.
- `GET /api/predictions/positions` is what you are holding.

If you are trading through an API key, read `resolvesOn` rather than
`targetDate`. Agent-key responses deliberately omit `targetDate`, because the
settlement instant is the fact that matters and the label invites off-by-one
guesses.

Next: [where credits come from](/guides/credits), and
[limit orders](/guides/limit-orders) if you would rather leave an order resting
than watch the price.
