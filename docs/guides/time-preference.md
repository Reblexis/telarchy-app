---
title: Time Preference
description: How TP nodes blend present and future market consensus, and how to configure half-life.
category: metrics
order: 40
---
# Time Preference

## Why it matters

A metric that only reflects its current value tells you where things stand *right now*. Time preference gives a metric a temporal dimension, blending present state with predicted future values using market consensus.

## How it works

Any metric (leaf or computed) can have time preference enabled. When enabled, the system:

1. Samples time points from an exponential curve defined by the half-life (count set by *market density*, default 3, configurable 1-50)
2. Creates prediction markets for the metric's leaf descendants (or itself, if it's a leaf) at those dates
3. Blends the consensus values at those future dates with the current value (t=0) into a single present-equivalent score

### Leaf metrics with TP

A leaf metric with time preference creates markets for *itself* at each sampled date. Its total becomes a blend of its current value and the market consensus at future dates. This is the simplest way to get forward-looking signal; just enable TP on any leaf you care about.

### Computed metrics with TP

A computed metric with time preference creates markets for all its *leaf descendants* at each sampled date. It evaluates its formula at each future date using the market consensus for those leaves, then blends the results.

### Metrics above TP nodes

Metrics above a TP node are purely compositional. They combine TP-enabled children via formulas and are themselves forward-looking as a result, because each TP child already delivers a blended present+future value.

## Why you can't nest TP nodes, and don't need to

On any path through the metric graph, at most one node may have time preference enabled.

A TP node expects everything below it to represent *current state*. If a second TP node sat inside that subtree, it would compute a future-blend of its own leaves and pass that up as if it were a current value. The outer TP node would then sample that already-blended future value at further future dates, a future-of-a-future with no coherent interpretation.

If you want metrics with different timescales, make them **siblings**, each with their own TP:

```
# Correct: sibling TP nodes with different half-lives
Overall  (formula: {ShortTerm} + {LongTerm})
├── ShortTerm  (TP: half-life=0.5y)  ← near-horizon concerns
└── LongTerm   (TP: half-life=5y)   ← far-horizon concerns

# Also correct: TP directly on a leaf
Revenue  (leaf, TP: half-life=1y)  ← markets created for Revenue itself

# Wrong: nested TP nodes
Overall
└── ShortTerm  (TP: half-life=0.5y)
    └── SubGoal  (TP: half-life=0.25y)  ← not allowed
        └── LeafMetric  (leaf)
```

## How values are labeled

The UI labels depend on whether time preference is enabled:

- **Leaf + TP**: Shows **Now** (your current self-report, editable) and **Outlook** (the TP-blended total combining present value with market consensus at future dates).
- **Plain leaf** (no TP): Shows **Now** (editable; total equals value, so no second number).
- **Formula + TP**: Shows **Outlook** (the TP-blended formula result). The "now" is computed from children and visible on their cards.
- **Plain formula** (no TP): Shows **Now** (the formula result computed from children's current values).

In the API response, `value` is the self-report (leaves only), and `total` is the final number after TP blending or formula evaluation.

## Half-life

The only parameter is **half-life** (in years). It sets the timescale of your concern; the median sampled time point falls exactly at the half-life:

- **Short half-life (e.g. 0.5y)** - near-term dominated; most weight on the next few months. Good for fast-moving or tactical metrics.
- **Long half-life (e.g. 5y)** - long-horizon; samples spread across years. Good for strategic or structural goals.

The blend is a simple average across t=0 and the sampled future points (equal weights). The half-life shapes *where* those samples fall, not how much each one counts. All samples share a single calendar granularity (day, week, month, or year), chosen as the coarsest one whose bucket width is at most the smallest gap between adjacent samples, so two samples can never land in overlapping buckets (no "2026-W23 plus 2026-06 both covering the same day" double counting).

## Custom market dates

Beyond the exponential curve, any metric can carry **custom market horizons**: an explicit list of extra dates to keep markets at. They work with the curve on or off (a metric can have purely manual horizons), and like the curve they propagate to leaf descendants. Two kinds of entry:

- **Rolling offsets**: `+Nh`, `+Nd`, `+Nw`, `+Nm`, `+Ny` (e.g. `+3m`, `+1h`). Re-resolved against "now" on every hourly refresh, so there is always a market about that far out. The offset's unit sets the market granularity: `+3m` maintains a month-market, `+2w` a week-market, `+6h` an hour-market. Want a standing intraday ladder? `["+1h", "+2h", ..., "+24h"]` keeps a market at every hour of the next day.
- **One-shot dates**: `YYYY`, `YYYY-MM`, `YYYY-Www`, `YYYY-MM-DD`, or `YYYY-MM-DDTHH` (e.g. `2026-12-31`, `2026-12-31T14` for 14:00-15:00 UTC). A single market that resolves at the end of that period and is not recreated. Fully-passed periods are pruned on save.

Configure them in the metric's edit modal ("Custom market dates"), or via the API: `timePreference.customHorizons` is an array of such strings (at most 24), e.g.

```json
{ "timePreference": { "enabled": false, "halfLife": 1, "customHorizons": ["+3m", "2026-12-31"] } }
```

`enabled` gates only the exponential curve; custom horizons generate markets regardless. Removing an entry deactivates its market (existing positions are kept and resolve normally). Custom-horizon markets are pure forecasting instruments: they show up in the future-predictions chart but do **not** feed the TP-blended outlook, which stays defined by the curve.

Note the difference from one-off manual markets (`POST /api/predictions/markets`): a manual market is a single row not tied to metric config; it survives the daily refresh untouched but is never recreated or rolled. Custom horizons are config: the system keeps the desired markets in existence for you.

## The "Current X" structural pattern

A common and recommended pattern is to separate the TP node from the current-state calculation using an intermediate "Current X" metric:

```
Product quality       (TP node, formula: {Current product quality})
└── Current product quality  (computed, formula: ({Reliability} + {Performance}) / 2)
    ├── Reliability  (leaf)
    └── Performance  (leaf)
```

The TP node's only job is temporal blending; it delegates all composition logic to its "Current" child. This keeps the two concerns separate:

- **TP node** - declares the timescale and drives market creation; formula is always just `{Current X}`
- **Current X node** - computes what the metric actually is right now from its leaves; no TP, no markets

Avoid collapsing these two levels into one. A single TP node with a complex formula works mechanically, but it obscures the structure and makes it harder to reason about what "current" means vs what the market forecast means.

## How to enable it

1. Create the metric (leaf or computed).
2. Open **Edit** on that metric.
3. Toggle *Time Preference* on and set the half-life in years.
4. Save. Markets are automatically created at the sampled dates plus any custom market dates (for the metric itself if it's a leaf, or for all its leaf descendants if it has a formula).

## Example

```
# Simple: TP on individual leaves
Revenue    (leaf, TP: half-life=1y)    ← markets for Revenue
NPS        (leaf, TP: half-life=0.5y)  ← markets for NPS

# Hierarchical: TP on computed nodes
Overall  (formula: {ShortTerm} + {LongTerm})     ← aggregates TP nodes
│
├── ShortTerm  (TP: half-life=0.5y)               ← temporal bridge
│   formula: {MetricA} + {MetricB}
│   ├── MetricA  (leaf)                            ← markets created here
│   └── MetricB  (leaf)                            ← markets created here
│
└── LongTerm   (TP: half-life=5y)                  ← separate timescale
    formula: {MetricC} + {MetricD}
    ├── MetricC  (leaf)
    └── MetricD  (leaf)
```
