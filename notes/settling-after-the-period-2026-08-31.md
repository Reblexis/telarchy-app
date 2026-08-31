# Proposal: settling after the period, not at the instant it ends

Written 2026-08-31, at the owner's ask: "shouldn't settlement dates be
actually after the range for that given market passes ... rather than before
it even ends? and if the value has to be set before that is just counter".
Nothing here is built.

## He is right about the mechanism

A market's settlement instant is the FIRST instant after its period
(`resolutionInstant` = `periodEndInstant`): a market on `2026-09` settles at
2026-10-01T00:00:00Z, and it settles on the last reading logged at or before
that instant. So the number it pays out on has to exist before September is
over.

For a level (users, followers, a balance) that is fine: the value at the
boundary is the thing being priced, and a reading taken shortly before it is
close enough. For anything that can only be known afterwards, it is not:
September revenue net of refunds is not knowable on 30 September, so what the
market settles on is the owner's guess at their own number, published as a
fact and paid out on. That is the opposite of what the platform sells.

## Why it was built that way, which is worth keeping

Determinism. The resolve cron drifts (twelve seconds to eighty minutes), and
settling on "the value when the resolver happens to run" made hour markets
settle against the previous or the next hour depending on the race. The rule
that fixed it is that the fixing is a function of the period, not of the job.
Any change has to keep that: a settlement instant that is knowable in advance,
and a late push that cannot retroactively move a market that has settled.

## The shape that keeps both

A per-metric **reporting lag**. The metric says how long after a period its
number is final, and the market's settlement instant becomes `period end +
lag`. Everything else stays exactly as it is: the fixing is still the last
reading at or before the settlement instant, still deterministic, still
independent of the cron.

What it buys:

- The owner gets the window they actually need, and it is the window they
  chose rather than one we guessed.
- Traders are told when they are paid, on the market itself: "settles 3 days
  after September, on the September figure". A market that pays two days late
  with no explanation is worse than one that says so.
- The stale-reading nudge gets sharper, because "late" finally means
  something: inside the lag, a missing reading is the owner's remaining
  window; past it, the market settles on whatever is there.

## The trap, and the two ways out

A metric with `resetsEvery` restarts each period, so a reading taken inside
the lag window is a reading of the NEXT period. A naive lag would settle
September on October's partial total, which is worse than what we have now.

- **(a) The reset waits for the settlement.** The metric keeps carrying the
  closed period's number until its market settles, and starts the new period
  after. Matches how people report ("September finished at 4,812"), needs no
  new field, and delays the new period's line on the chart by the lag.
- **(b) A push can name its period.** `PUT /api/metrics/:id { value,
  forPeriod: "2026-09" }` writes a reading attributed to a closed period.
  Exact, works for any lag, and adds a field that can be got wrong silently,
  which is the failure mode this whole area is supposed to avoid.

I would take (a) for metrics that reset, and no lag at all by default for
levels, which do not have the problem.

## What to decide

1. Do we add a per-metric reporting lag at all, or leave settlement at the
   period boundary and treat "report before the end" as the owner's job?
2. If we add it: a default per period type (an hour market waits minutes, a
   month market waits days), or zero unless the owner sets one?
3. For metrics that reset: (a) the reset waits for settlement, or (b) a push
   can name its period?

## Decided and built, 2026-08-31 (Viktor)

Yes to the lag, and with it: "metric updates should be possible to be done at
a given timestamp, meaning when a metric value is updated a past date should
be fillable, for this exact purpose". So both halves shipped together:
`settlementLagMinutes` on the metric, stamped onto each market as it opens,
and `asOf` on a reading.

On the reset trap he chose neither of the two ways out in this note, and was
right to: "when the new metric market is spawned it's spawned with the latest
logged value, it doesn't matter that it's technically mispriced, it's the best
easy estimate we have, it's up to Telarchy agents to potentially correct that
later, but not that big a problem right now." So nothing special happens at a
reset: the new market opens on the last reading and is priced from there.

The rules are in `docs/guides/sources.md`, "The number is final after the
period, not at it".
