---
title: Keep the number true
description: The one way a value gets in, what a market actually settles on, and why a source is not an ingestion path.
category: run
order: 40
---
# Keep the number true

A market on your floor pays real credits against a number you typed. If that
number is late, wrong, or quietly edited, the payout is wrong and the people who
priced it correctly lose. So the way values get in matters more than anything
else you configure.

## There is exactly one write path

```
PUT /api/metrics/:id
{ "value": 4812.55, "oldValue": 4630.10,
  "updateNote": "Stripe daily close, 2026-08-30" }
```

That is it for the value. There is no bulk update, no CSV import, no webhook
that writes a value, and no integration that polls anything. One route below
writes dated READINGS, for history you already have; it never touches the
value. `PUT /api/metrics/:id` needs the
`manage` capability, and the fields you may send are `name`, `description`,
`value`, `formula`, `marketRangeMax`, `timePreference`, `resetsEvery` and
`resolvesNaUntilMeasured`, plus the two that are about the update rather than
the metric: `oldValue` and `updateNote`.

**Always send `oldValue`.** It is optional, and omitting it silently drops the
audit entry: the value still writes, no error and no warning, but nothing
records that a change happened or why. The audit row is written only when all of
these hold: the metric is a leaf, `oldValue` is present, `value` is present, and
the two differ. Read those rows back with `GET /api/updates`.

`updateNote` is **not** required, whatever older guides said. Send it anyway.
Without one the row reads "Value updated", which is exactly as informative as
nothing.

## Backfilling a past you can prove

```
POST /api/metrics/:id/logs/backfill
{ "readings": [ { "at": "2026-07-01T00:00:00Z", "value": 3589.4 },
                { "at": "2026-07-02T00:00:00Z", "value": 3571.2 } ] }
```

The one route that writes DATED readings, and the only exception to the rule
above. It exists for a metric whose past is already published somewhere: a
public statistic with two years of history starts life on Telarchy with a
single point, and a forecaster cannot read a trend off one dot. Backfill puts
the points where they actually happened.

It writes readings and nothing else. The metric's current `value` does not
move, no change-log row is written, and there is no `updateNote`, because
nobody measured these today. Needs `manage`.

Three refusals keep it away from settlement, which is the only thing dated
writes could endanger:

- **Every `at` must be strictly older than the metric's oldest existing
  reading** (400 otherwise, naming that reading). Backfill extends history
  backwards; it never inserts alongside or after the readings a live floor has
  been writing, so it cannot become the "last reading at or before" any
  instant a market resolves on. A consequence worth knowing: you can run it
  again with an even older stretch, but you cannot use it to patch a gap in
  the middle, and re-sending the same batch is refused rather than duplicated.
- **The metric must have no resolved market** (409). Once something has
  settled, that history is evidence, and nobody gets to add points behind it.
- **At most 2000 readings a call**, each with a finite value and a parseable
  instant, and no two at the same instant (400).

## Two histories, and only one of them settles markets

They are separate tables and they behave differently, which is worth knowing
before you go looking for a number that is missing.

- **The reading log** is what the chart draws and what markets settle against.
  A reading is written whenever your request carries `value` or `formula`, and
  it does not care about `oldValue`. Read it with `GET /api/metrics/:id/logs`.
- **The change log** is the human record: old value, new value, your note. It is
  the one `oldValue` gates. Read it with `GET /api/updates`.

A rename, a description edit, a range change or a time-preference change writes
no reading. That is deliberate: those are not measurements, and logging one
stamps the previous number with today's timestamp. Renaming a weekly metric on a
Monday morning once did exactly that, filing last week's total as a reading
inside the new week.

## The fixing: what a market actually settles on

**A market settles on the metric's last logged reading at or before its
`resolvesOn` instant.** Not the value at the moment the resolver happens to run,
and not any forecast: on a leaf it is exactly the number you pushed, and on a
computed metric it is your formula over the numbers its leaves were pushed.
Market prices never enter it, so nobody can move the number they are being
scored against.

That distinction is the whole point. The resolve job drifts, observed anywhere
from twelve seconds to eighty minutes late, and settling on the live value would
make an hourly market resolve against the previous or the next hour depending on
that race. The fixing is deterministic instead: **an update that lands a second
after the boundary counts toward the next period, never this one.**

Plan your pushes around the boundary, not around the cron. If your number is
produced at 00:05 for the period that ended at 00:00, that reading belongs to
the next period, and the market that just closed settles on whatever you last
pushed before midnight.

Two more rules worth knowing at settlement time:

- **The actual value is clamped to the market's range top.** A metric that blows
  past `marketRangeMax` settles at the ceiling.
- **A metric with no reading at all at the boundary** falls back to the live
  value and logs a server-side error, because that path is the only one where
  cron timing still affects the result. Set `resolvesNaUntilMeasured: true` on a
  number that does not exist until something happens (the valuation implied by
  an investment, say) and the market voids as N/A instead, refunding every
  position with the reason published. The first reading ends that state for
  good.

## Push on a schedule, as often as your shortest market

There is no scheduler inside Telarchy. "Auto-sync" means you write a script and
run it on a cron, and the script does one `GET /api/metrics` to find the id and
one `PUT` per number it measured.

Telarchy does this to itself, hourly, against the same public endpoint its own
markets settle on. Four habits are worth copying:

1. **Push every reading you actually took, changed or not.** The reading log is
   the "actual so far" line on your floor, so a number that comes back the same
   is still a point on it, and a market on a flat number has a chart instead of
   a single dot. What fabricates history is the opposite: writing a value you
   did not measure, which is why a rename or a description edit writes no
   reading. Resolution reads the last reading at or before the boundary, so
   pushing more often never changes a settlement, it only makes the line real.
2. **Match the metric by name and fail loudly when it is missing.** A rename in
   the app that nobody mirrored into the script is how a number silently stops
   updating on a market that is about to settle.
3. **Give the script an ordinary participant key with `manage` on that one
   workspace**, not a master key. Its blast radius should be one workspace and
   one metric.
4. **Watch the scheduler itself, not just the script.** An "hourly" job that
   your scheduler delivers once a day looks exactly like a healthy one from the
   inside: every run succeeds. Compare the reading log against the clock you
   promised, not against the job's own green ticks.

Push the number from the same place the number is defined. If your metric's
description says "Stripe gross minus refunds, read on the 1st", the script
should compute exactly that. Two copies of a number is how a page starts
disagreeing with itself.

Note that `POST /api/metrics/logs/purge` exists and deletes reading rows. It
destroys the history markets settle against. There is no reason to run it on a
live floor.

## Sources are context, not ingestion

This is the part the old guide got wrong, and it matters because the name
suggests otherwise.

**A source is an information store for people to read.** It has a name, a
description, a type and content. There are two types: `text`, free-form content
stored on the source, and `github`, a read-only bridge to a repository that
participants can browse through the API without holding a token themselves.

A source has **no `metricId`, no cadence and no sync**. Nothing polls it.
Nothing reads a number out of it. Publishing a source does not update a metric,
and a metric never reads from a source. If you connect a GitHub repository, no
value moves; forecasters just get to read the code your metric is about.

What sources are actually for is closing the gap between "the market says 25"
and a visitor who cannot tell whether 25 is right. Definitions, provenance, a
data room, whatever a stranger would need to price you honestly.

```
GET  /api/sources                             # list what you can read
GET  /api/sources/:id                         # text content and metadata
GET  /api/sources/:id/tree?path=src/lib       # directory listing, github
GET  /api/sources/:id/file?path=src/index.ts  # file contents, github
POST /api/sources                             # create, needs manage
PUT  /api/sources/:id                         # edit, needs manage
```

Access is per group: creating, editing and deleting need `manage`, reading needs
`read`, and anyone with `manage` can read every source. A group gets a source by
having it flagged in its `sourcePermissions` map. Unlike the per-metric read
flag, this one is enforced.

**Granting the Public group `read` on a source publishes it.** A published
source appears in `GET /api/marketplace/:idOrSlug/context`, the one-read brief
that a forecaster's model can consume whole, and it is what Otto answers from on
your floor. Publishing is always an explicit act; nothing turns a private source
public as a side effect.
