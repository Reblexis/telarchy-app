---
title: Pick which future dates get a market
description: How half-life chooses which future dates open markets, and how to pin an exact date.
category: run
order: 50
---
# Pick which future dates get a market

A metric on its own tells you where you stand right now. Time preference is how
you say which futures you care about: it decides **which future dates open
markets** on this metric, and that is all it decides.

It does not change what the metric reads. A leaf reads the value you measured;
a computed metric reads its formula over those values. Market prices never feed
back into either, which is what lets a market settle honestly: the number a
market settles on is a measurement, and the market's own price is not part of
it. If prices could move the reading, traders would be moving the number they
are scored against.

The resolver never reads your half-life either. A market settles on the metric's
logged reading at its own resolution instant, so changing your mind about
horizons never changes how an existing market pays: a date you drop deactivates
its market, and that market still resolves normally with every position intact.

*(Until 2026-08-30 a curve-enabled metric published a blended "outlook" that
averaged your reading with the consensus at each sampled date, and settlement
preferred that blend. A market on such a metric settled partly against its own
price. The blend is gone; nothing in the product blends a reading with a
forecast now.)*

It is a field on the metric, `timePreference`, set through `POST /api/metrics`
or `PUT /api/metrics/:id`. There is no toggle in a browser.

```json
{ "timePreference": { "enabled": true, "halfLife": 1, "density": 3,
                      "customHorizons": ["+3m", "2026-12-31"] } }
```

## Half-life is in years

`halfLife` is the timescale of your concern, in years, and it must be positive.
The sampler draws from an exponential decay curve with that half-life and takes
quantile midpoints, so **the median sampled date falls exactly at the
half-life**.

- `0.5` puts most of the weight in the next few months. Tactical numbers.
- `5` spreads the samples across years. Structural ones.

`density` is how many future dates get sampled. **It defaults to 3**, and it
must be a positive integer. Higher density means more markets, and every one of
them needs liquidity to have a price at all, so raise it deliberately.

All samples share one calendar granularity: the coarsest of day, week, month or
year whose bucket is no wider than the smallest gap between adjacent samples.
That is what stops two samples landing in overlapping buckets, where a weekly
market and a monthly market would both cover the same day on the same metric.

Omitting `timePreference` entirely on `POST /api/metrics` gives you
`{ enabled: true, halfLife: 1 }`. Pass `null` to keep a metric with no curve.

## Leaf, computed, and above

- **A leaf with time preference** opens markets on itself at each sampled date.
  This is the simplest useful setup and it is what the templates do.
- **A computed metric with time preference** opens markets on all of its leaf
  descendants at each sampled date, so the futures you care about are priced at
  the level where they are actually measured.
- **A metric above a time-preferenced one** adds nothing of its own. Its
  children already have the horizons.

**At most one metric on any path may carry the curve**, so that one subtree does
not open two competing sets of dates on the same leaves.

Enabling it on a metric whose ancestor already has it returns 400 from
`PUT /api/metrics/:id`, naming the ancestor. Enabling it on a parent removes the
curve from its descendants and warns you which ones. Custom horizons are an
explicit choice and survive that demotion.

For metrics with genuinely different timescales, make them siblings:

```
Overall  (formula: {ShortTerm} + {LongTerm})
├── ShortTerm  (halfLife 0.5)
└── LongTerm   (halfLife 5)
```

A pattern worth borrowing: keep the time-preferenced node's formula as nothing
but `{Current X}`, and let a separate "Current X" metric do the composition. The
node then has one job, declaring the timescale, and "what this is right now" and
"what the market thinks it will be" stay two visibly separate things.

## Pinning an exact date

`customHorizons` is a list of extra dates to keep markets at, working with the
curve on or off. A metric can have purely manual horizons. At most 24 entries,
and duplicates are dropped.

**Rolling offsets** are `+Nh`, `+Nd`, `+Nw`, `+Nm`, `+Ny`. They are re-resolved
against now on every refresh, so there is always a market about that far out,
and the unit sets the market's granularity: `+3m` maintains a month market,
`+2w` a week market, `+6h` an hour market. `+0w` is the current period, which is
how you say "revenue this week" and have it mean this week rather than the next
one. A standing intraday ladder is `["+1h", "+2h", ...]`.

**One-shot dates** are `YYYY`, `YYYY-MM`, `YYYY-Www`, `YYYY-MM-DD` or
`YYYY-MM-DDTHH` (hour, UTC). One market, resolving at the end of that period,
never recreated. Dates whose period has already passed are pruned on save
rather than rejected, so re-saving an old config never fails.

Two properties to plan around:

- **A custom horizon is just another date to price.** It appears on the chart
  and in the market list and settles like any other market. Like the curve, it
  changes nothing about what the metric reads today.
- **Removing an entry deactivates its market rather than voiding it.** Trading
  stops, existing positions are kept, and it resolves normally. Changing
  `timePreference` in general reconciles: stale dates deactivate, newly desired
  dates are created, positions are never taken away.

A one-off market created directly with `POST /api/predictions/markets` is a
different thing: a single row not tied to metric config, which survives the
refresh untouched but is never recreated or rolled. Custom horizons are
configuration, and the system keeps the markets you asked for in existence.

## Count the markets before you turn it up

Markets are the product of metrics, sampled dates and custom horizons, and every
one of them needs liquidity or it has no price. Three metrics at density 3 plus
two custom horizons is fifteen markets, and each contract posted against that
floor spawns two more per market. Set `newMarketLiquidityCredits` with that
number in mind, and see [open a floor](/guides/creating) for how funding
actually behaves when your balance runs short.
