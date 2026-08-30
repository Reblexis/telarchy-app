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

That is it. There is no bulk update, no CSV import, no webhook that writes a
value, and no integration that polls anything. `PUT /api/metrics/:id` needs the
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
`resolvesOn` instant.** Not the value at the moment the resolver happens to run.
On a plain leaf that reading is exactly the number you pushed; on a leaf with
the time-preference curve enabled it is the blended outlook, which is one more
reason to read [time preference](/guides/time-preference) before turning the
curve on.

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

## Push on a schedule, and only when it moved

There is no scheduler inside Telarchy. "Auto-sync" means you write a script and
run it on a cron, and the script does one `GET /api/metrics` to find the id and
one `PUT` per changed number.

Telarchy does this to itself, and the script is in the repo:
`scripts/telarchy-self-sync.js`. It runs hourly, reads the public endpoint its
own markets settle against, and pushes. Three habits in it are worth copying:

1. **Only write a changed number.** The reading log is public and traders audit
   it, so twenty-four identical rows a day bury the real ones. Resolution reads
   the last reading at or before the boundary regardless of how old it is, so a
   gap between changes settles exactly the same way.
2. **Match the metric by name and fail loudly when it is missing.** A rename in
   the app that nobody mirrored into the script is how a number silently stops
   updating on a market that is about to settle.
3. **Give the script an ordinary participant key with `manage` on that one
   workspace**, not a master key. Its blast radius should be one workspace and
   one metric.

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
