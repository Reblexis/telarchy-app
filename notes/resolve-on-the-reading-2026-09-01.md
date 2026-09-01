# A market resolves on its reading, not on a clock

Owner direction, 2026-09-01:

> dont cap it and instead allow trading on it even if the "settlement date"
> has passed or whatever. up until it is resolved and only way that that can
> be done is if there is an update of the metric at that exact date that the
> market is supposed to settle at.

This note is the design that follows from it, what it costs, and the one
question it does not answer. Nothing is built yet.

## What it replaces

Today a market has two instants: its period end, when the answer is fixed,
and its period end plus `settlementLagMinutes`, when it settles. Trading
stops at the first (shipped 2026-09-01, PR #123) and payout happens at the
second.

That split exists because the settling number is the last reading dated at or
before the period end, so once the period ends the answer is determined, and
between the two instants it is either already public or known only to the
owner who will file it. Neither is a state to keep taking bets in.

## What this replaces it with

One instant, and it is an event rather than a time.

**A market resolves when a reading dated inside its period arrives.** Not
before, whatever the clock says. Trading stays open until then, because until
then nobody has the answer: the September market is a live question until
September's number is filed.

The gap closes because there is no gap. The moment the answer exists the
market is resolved, so there is never an interval where the answer is public
and the book is open.

## Why this is better than what is live

The current rule stops trading at the period end even when the number is not
knowable yet, which is the normal case for any metric with a reporting lag.
It closes a live question early to protect against an answer that has not
arrived. This design protects against the answer instead of against the
calendar, which is the thing that actually matters.

It also deletes a concept. `settlementLagMinutes` stops being "how long after
the period we wait to pay" and the second instant disappears from the trading
rules entirely.

## What it takes

| Surface | Change |
|---|---|
| `services/predictions.ts` | Resolve only when `metricLogs` has a row for this metric with `timestamp` inside `[periodStartInstant, periodEndInstant]`. `metricReadingAsOf` bounds only above today; the lower bound is the whole change. |
| `services/trading.ts` | Drop the period-end refusal added in #123. Resolved and voided stay refused, which is now the only gate that matters. |
| `routes/metrics.ts` | Filing a reading with `asOf` inside a period should settle that period's markets promptly, rather than waiting for the next cron tick. |
| Error codes | `market_settling` becomes unreachable. It is published, so it stays documented as retired rather than removed. |
| Docs | `market-integrity.md` ("Trading stops when the answer is fixed" is replaced), `guides/markets.md` (the `settling` state goes), `guides/sources.md` (filing a reading is what resolves a market). |
| Collectors | A collector that files readings is now what triggers settlement. `telarchy-agents/collectors` needs to know that its `asOf` decides which market settles. |

## The question this does not answer

**What ends a market nobody files a reading for.**

Under "resolve only on the reading", a metric whose owner never files September
leaves the September market open forever, and every credit in it locked
forever. That is a worse lockup than the one this started as a fix for.

Three ways to close it, in order of how much I would want them:

1. **The lag becomes the deadline.** `settlementLagMinutes` stops meaning
   "wait this long, then settle" and starts meaning "wait this long for the
   reading; if it does not come, void and refund everyone". The machinery
   exists: `resolvesNaUntilMeasured` already voids-and-refunds a market whose
   number never arrived, with the reason published. No new concept, and the
   field keeps a job.
2. **A flat platform deadline**, say 30 days past the period, after which any
   unresolved market voids. Simpler, ignores that a monthly close and a daily
   metric need different patience.
3. **Nothing.** Markets stay open until someone acts. Honest, and it makes an
   absent owner able to freeze other people's credits indefinitely.

I would take 1.

## The cost worth naming

This widens the owner's information window. Today the owner can trade on
knowledge of their own number up to the period end. Under this design they can
sit on September's number for as long as they like, trading against people who
are guessing, and file when it suits them.

That asymmetry already exists in any owner-reported market, and the period end
merely bounded it. Two things bound it here instead: the deadline above caps
how long they can sit, and `strictEligibility` already excludes accounts
operating a public workspace from any prize payout. It defaults to true and is
off only for Season 0.

It is worth being clear that this is a real trade: the design buys honest
price discovery during the lag and pays for it with a longer window in which
the owner knows something the market does not.
