# Revenue markets opening at $20 against a $5 reading (2026-09-02)

Viktor, 2026-09-02: "why do the telarchy revenue markets not spawn at 0 or
very close to it given that tis the latest valeue? especiallly the
conditional ones.. please fix that."

## What the floor showed

On the Telarchy floor, every fresh daily market on "Telarchy revenue (USD)"
(range 0-1,000, reading $5) opened at $20, and every conditional branch
under it opened at $20 too. "Implied valuation (USD)" (range 0-20,000,000,
reading $0) opened at $400,000. Both are the same number: 2% of the range,
the floor of the price clamp in `anchoredMarketState`. A reading below 2%
of its range could not be priced; the book opened at the clamp and the
clamp read as a forecast.

Older approved-branch conditionals told a second story: four "Telarchy
revenue (USD)" September markets and one September-week "Implied
valuation" market, all on approved jobs, sat untraded at the range
midpoint ($500, $10,000,000). They were opened before the 2026-08-31 rule
that a book opens at the reading, and nothing re-anchors a book once it
is open.

## What changed (shipped)

The clamp is one part in a thousand: `[0.001, 0.999]`, in
`ANCHOR_P_FLOOR` (`functions/src/lib/amm.ts`), the only place it lives.
A reading inside the clamp opens at the reading ($5 opens at $5); a
reading at the edge opens as close to it as a solvent book can be placed
($0 on 0-20,000,000 opens at $20,000, not $400,000). The cost is depth:
the subsidy still covers the worst case exactly, so the book at the clamp
is b = subsidy / ln(1000), 1.8 times thinner than the 2% floor bought and
ten times thinner than a centre open. `docs/ui-conventions.md` carries the
rule; the tests in `amm.test.ts`, `conditional-open.test.ts`,
`anchored-injection-solvency.test.ts` and `conditional-anchor.test.ts` pin
it and its solvency.

Existing books do not move on their own. The daily markets roll over at
midnight UTC and open at the new floor; the older untraded books are
repaired by hand once the build is published (see the record at the end
of this note).

## Proposal: an untraded book tracks its anchor

Not built; Viktor decides. The midpoint books above are the general case:
a book that nobody has traded carries no forecast, only the number it was
opened at, and that number goes stale the moment the reading (or, for a
conditional, its baseline) moves. Today the hourly refresh opens missing
books at the current anchor and leaves open ones alone.

Rule: **on every refresh, a market with no trades is re-anchored at the
price the same refresh would open it at now.** Baselines re-anchor at the
reading; conditional branches at their baseline's current price (minus the
ask on the approved branch of a money metric, as at spawn). Liquidity
injections are unaffected: the pool stays, b and the shares are recomputed
by `anchoredMarketState` for the new anchor, and the book stays exactly
solvent because that is what the function does.

- For: the price a stranger sees on an untraded book is always the one
  the rules say it should have opened at. Rule changes like today's, and
  readings that move before anyone trades, fix themselves within the hour.
  It removes the hand repair below as a category.
- Against: an untraded market's chart moves without a trade, which needs a
  sentence on the market page ("no one has traded this; it follows the
  reading"). A trade submitted in the same second as a refresh fills at the
  re-anchored price, which is the correct price, but not the one the trader
  looked at.
- Alternative: leave books alone and accept that an untraded book is a
  snapshot of the day it opened. Cheaper, and it is what produced the $500
  markets on approved jobs.

Recommendation: adopt the rule. The floor already promises that an open is
not a forecast; keeping that promise for the life of an untraded book is
the same promise.

## Record: the untraded books were re-anchored by hand, 07:05 UTC 2026-09-02

Sixty-five open markets in the Telarchy workspace with no trades were set
to the price the engine would open them at now, by the rule proposed
above applied once: baselines at the reading, conditional branches at
their baseline's current price (the re-anchored baseline, for the daily
ones) minus the ask on the approved branch of a money metric. For each,
the pool is untouched and `anchoredMarketState(pool, anchor)` supplied the
new shares and b, so every book is exactly as solvent as before. Nobody
held a position in any of them, so no one's money moved. Their previous
shares and b are in `notes/reanchor-2026-09-02-before.json`, by market id.

What a visitor sees after it: the daily "Telarchy revenue (USD)" market
and the branches under it at $5 (were $20), "Implied valuation (USD)" at
$20,000 (was $400,000), "Active traders" dailies at 4 (were 1.0), the four
September revenue branches on approved jobs at $98.40, the baseline's
price (were $500), and the valuation branches at their baselines' $806k
and $820k (were $10,000,000). Resolved markets were not touched; the $500
and $10,000,000 prints in the history of approved jobs are what those
markets settled at and stay.

The clamp change itself reaches the floor when the build is published;
until then a daily market opened at midnight still opens at the old floor.
