---
title: Pick which future dates get a market
description: How half-life chooses the horizons, what the blended outlook is, and how to pin an exact date.
category: run
order: 50
---
# Pick which future dates get a market

A metric on its own tells you where you stand right now. Time preference is how
you say which futures you care about, and it does two things:

1. It decides **which future dates open markets** on this metric.
2. It produces the **outlook**, a single number blending today's reading with
   what the crowd says those dates will hold.

The resolver never reads your half-life. A market settles on the metric's logged
reading at its own resolution instant, so changing your mind about horizons
never changes how an existing market pays: a date you drop deactivates its
market, and that market still resolves normally with every position intact.

One coupling is indirect and worth knowing before you enable the curve. The
reading written to the log is the metric's outlook, and on a leaf whose curve is
**enabled** the outlook is the blend, not your raw entry. So a market on such a
leaf settles against a figure that already contains market consensus. A leaf
with the curve off, using custom horizons only, logs the number you entered and
is unaffected. If you want the market to settle on your reading and nothing
else, that is the configuration to use.

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

The blend is a plain average across today and the sampled dates, each counted
once, because equal probability mass per bin is what the quantile sampling is
for. Half-life decides *where* the samples fall, not how heavily each one counts.

Omitting `timePreference` entirely on `POST /api/metrics` gives you
`{ enabled: true, halfLife: 1 }`. Pass `null` to keep a metric with no curve.

## Leaf, computed, and above

- **A leaf with time preference** opens markets on itself at each sampled date.
  Its outlook blends its own reading with those prices. This is the simplest
  useful setup and it is what the templates do.
- **A computed metric with time preference** opens markets on all of its leaf
  descendants, evaluates its formula at each future date from those prices, and
  blends the results. A leaf with no market at a sampled date contributes 0 to
  that evaluation, which is worth remembering when half your leaves are
  unfunded.
- **A metric above a time-preferenced one** is purely compositional. It is
  forward-looking already, because each child it combines is.

**At most one metric on any path may carry the curve.** A second one inside the
subtree would blend its own leaves into a future value and hand it upward as if
it were today's reading, and the outer node would then sample that already
blended number at further future dates. There is no coherent reading of a
future of a future.

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

- **Custom horizons do not feed the outlook.** They are pure forecasting
  instruments: they appear on the chart and in the market list, and the blended
  number stays defined by the curve.
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
