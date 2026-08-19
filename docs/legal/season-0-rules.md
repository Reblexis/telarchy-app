# Season 0: official rules

_Published 2026-08-17, renamed to Season 0 on 2026-08-19. Amended twice on
2026-08-19, both before the season started: how an open position is valued was
made exact, the text was shortened with no change in substance, and then the
valuation itself was changed to the resolve-now value described below. These
rules do not change while the season runs._

**Season 0 is the first one, and the platform is still being launched.** Expect
rough edges, apologies in advance. If something looks wrong, tell us through
the feedback channel in the app; where a bug affects standings we say so
publicly and publish the correction, as the disputes section commits us to.

## What this is

A forecasting contest on the public Telarchy trading floor. Entrants are
ranked on how much their trading profit grows while the season runs; the top
five are paid real money.

## Free entry, no purchase, no stake

You pay nothing to enter and risk nothing you own. Credits are play money:
they cannot be bought, have no cash value, and are never exchanged for a prize
or redeemed. A prize is for where you place under the scoring rule below, not
for credits, and your credit balance is unaffected by winning or losing.

## Dates

From the published start instant to the published end instant, both UTC, shown
on the season page. Entries close when the season ends; settlement and prizes
follow the end.

## The prize pool

Total pool: **$1,000 USD**, awarded as:

| Place | Prize |
|---|---|
| 1st | $500 |
| 2nd | $250 |
| 3rd | $125 |
| 4th | $75 |
| 5th | $50 |

A rung nobody qualifies for, and anything otherwise unassigned, rolls into the
next season's pool.

## The scoring rule

```
season score = your trading profit now - your trading profit when the season started
```

Trading profit is what your positions are worth at current market prices, plus
refunds from cancelled markets, minus the net cash you paid. An open position
is worth what it would pay if the market resolved right now at the number the
market currently calls: your share count times that number. It is the same
number as the public leaderboard, open positions count before anything
resolves, and credits the platform granted you never enter it.

Two consequences worth knowing before you trade. Buying moves the price, so a
large buy shows a gain on the board the moment it lands, before anything in the
world has happened; the per-market position cap is what bounds this, and the
gain goes away if the market comes back to where it was. And the trading desk's
"worth" line beside your position is a different number, what a sell would
actually pay you today, which is lower. The board and your season score use the
resolve-now value described here.

- **Everyone's baseline is read when the season starts, not when they enter.**
  Entering late cannot pick a favourable starting point; entering early buys
  nothing except not having to remember.
- **An account that did not exist at the start has a baseline of zero**, so
  everything it earns inside the window counts.

Only entrants who explicitly opted in are ranked or paid.

## Eligibility

- 18 or older, with a Telarchy account, explicitly opted in. Entry opens when
  the season is announced, before it starts.
- Entering means agreeing to these rules, and we record when you agreed. No
  payment details are needed to enter; winners are asked at claim time.
  Leaving is one click.
- Participants operated by us or run as part of the platform are **not
  eligible**.
- A prize requires a season score **strictly greater than zero**; exactly
  zero, or a loss, wins nothing regardless of place.

We may disqualify entries that we determine, acting reasonably, are one person
running several accounts, or collude to distort prices.

## Ties

Broken by earlier entry into the season, then by participant id. Both are
automatic and give the same result on any recount.

## Voided markets

We do not void markets during a running season, except to correct a declared
error, and if we do, we announce it.

## How winners are paid

Telarchy holds, transmits, escrows and processes no funds. After settlement,
winners have **30 days** to claim, by adding payment details to their account
and pressing claim on their account page; the workspace owner then pays the
winner directly, outside the Service, the same arrangement paid job proposals
use (Terms of Service section 3). A prize not claimed within 30 days rolls
into the next season's pool. Winners are responsible for taxes on amounts
received.

## Cancellation

We may end or void a season. If we do, we say so on the season page, and no
prize is owed.

## Disputes

Write to us through the feedback channel in the app. We answer, and we publish
any correction to standings rather than making it silently.
