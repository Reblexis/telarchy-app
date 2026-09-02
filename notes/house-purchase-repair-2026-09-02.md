# The owner's own $5 was the whole revenue number (repaired 2026-09-02)

Viktor, 2026-09-02: "also could you not couont revenue earned from my own
account (viktor36 purchases)?" and, once the rule had shipped, "could you fix
the damage and publish".

Record, not a governing doc. The rule lives in `docs/metrics.md` ("Revenue,
trailing 30 days") and `docs/liquidity-purchases.md` ("Revenue, and what it
does not buy"): a liquidity purchase made by a platform-admin account is not
revenue, because the operator paying itself moves no money into the business.
Shipped in commit 393aea3f (PR 162), published as Cloud Run revision
api-01346-xap at 07:41 UTC.

## What the $5 did

On 2026-09-01 at 11:42 UTC the owner's account (Viktor36, flagged platform
admin) completed a $5 liquidity purchase on the Telarchy floor. The hourly
self-sync at 12:40 recorded "Telarchy revenue (USD)" going from $0 to $5, and
the metric read $5 for nineteen hours, until the fixed build's sync at 07:40
on 2026-09-02 recorded it back to $0.

In that window:

- 19 hourly readings of $5 landed in the public metric log, plus one
  `updates` row ($0 to $5) and, after the fix, a second ($5 to $0).
- The 2026-09-01 daily market and its approved branch on one job settled at
  $5 at midnight. One trader (the-big-boss) held 88.704 "lower" shares and
  was paid 88.26 credits (0.995 per share) instead of 88.704; the other
  trader's position had netted to nothing. The approved branch had no
  positions, so its LP leftover of 250 credits was unaffected.
- The 2026-09-02 daily market and the ten conditional branches under it
  opened at midnight against the $5 reading, and were re-anchored at $5 by
  the hand repair recorded in `untraded-books-and-the-price-floor-2026-09-02.md`.
  None had a trade.
- The W36 and 2026-09 markets carried real trades at $69.68 and $98.40; the
  $5 was noise against those forecasts and nothing about them was touched.

## What was repaired, by hand, 07:41 to 07:42 UTC

Previous state of every row touched is in
`house-purchase-repair-2026-09-02-before.json`.

1. The 19 metric-log readings of $5 were set to $0, and both `updates`
   transitions ($0 to $5, $5 to $0) were deleted, so the public log reads $0
   throughout, which is what the metric was under its definition.
2. The two settled 2026-09-01 markets had `actual_value` set from 5 to 0, and
   the-big-boss was credited the 0.444 credits the $5 settlement withheld
   (a `payout` ledger row against the market). The leaderboard values
   payouts from `actual_value`, so it agrees with the ledger.
3. The eleven untraded 2026-09-02 books (baseline plus ten branches, pool
   250 each) were re-anchored at the price the engine opens a $0 reading at
   on a 0-1,000 range: the clamp, $1 (`anchoredMarketState(250, 0.001)`,
   b = 36.19, shares [249.96, 0]). Pools untouched; nobody held a position.
4. The metric's floor description gained one clause saying house purchases
   are excluded; the change is in the metric's public revision log.

Not done, deliberately: the W36 and 2026-09 books, which have trades, and the
$5 `liquidity_purchases` row itself, which is a real Stripe payment and stays
on the books as `houseUsd` (`GET /api/liquidity/revenue`).
