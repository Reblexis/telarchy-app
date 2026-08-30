---
title: Markets & Forecasting
description: How prediction markets work, the binary AMM, resolution, and range configuration.
category: forecast
order: 10
---
# Markets & Forecasting

Every **leaf** metric has prediction markets attached to it. Markets let participants predict what value the metric will reach at a target date. The stake-weighted outcome is the *market consensus*, the crowd's best estimate of the future value.

## How the AMM works

Markets use a binary LMSR (Logarithmic Market Scoring Rule). Each market has a **range** (`rangeMin` to `rangeMax`, default 0-1000). Participants predict `higher` or `lower`. Buying higher shares pushes the consensus up; buying lower pushes it down.

The **consensus** is the market's predicted value for the metric:

```
consensus = rangeMin + p(higher) * (rangeMax - rangeMin)
```

This is the number to read. If a metric has range 0-1000 and consensus=650, the market predicts the value will reach 650.

The API also returns a **probability** field: p(higher) = (consensus - rangeMin) / (rangeMax - rangeMin). This is the predicted value expressed as a fraction of the range (0-1), **not** a probability of improvement or a binary outcome. With the default range 0-1000, probability=0.65 simply means the market predicts a value of 650.

At resolution, payouts are proportional to where the actual value falls in the range.

## Market creation

Markets are created automatically (when a time-preferenced ancestor is enabled, when custom market dates are added, or on the hourly refresh cron at minute 10) for each leaf metric at the sampled time points plus any custom horizons. Manual one-off markets (`POST /api/predictions/markets`) on metrics without a time-preference config are left alone by the refresh. All sample points for a given (halfLife, density) share a single calendar granularity (day, week, month, or year; custom horizons can additionally be hour-granular), picked as the coarsest one whose bucket width is at most the smallest gap between adjacent samples, so each (metric, date) market is unique and no two markets ever cover overlapping spans of the same metric.

New workspaces have **auto-funding enabled by default** (0.5 credits per market), so each new non-proposal market debits the workspace owner's balance automatically. The owner can adjust or disable this in workspace settings. Proposal-scoped conditional markets follow a separate per-proposal subsidy model; see *Credits & Liquidity* for details.

## Target date formats

```
2026          year granularity
2026-06       month granularity
2026-W24      ISO week granularity
2026-06-15    day granularity

+7d           7 days from now (resolved at creation)
+4w           4 weeks from now
+3m           3 months from now
+1y           1 year from now
```

`targetDate` is an **input form** (granular: year, month, ISO week, or day) you pass when creating a market or trading by metric. It is NOT returned to agent-key callers: agent market responses carry only `resolvesOn`, the single field that matters for timing. (Browser/UI responses still include `targetDate` for display.)

`resolvesOn` is the **exact UTC instant the market settles**, as a full ISO timestamp. Resolution runs hourly at minute 0 (UTC), settling each market on the first run after its period closes, so a market for `2026-06` resolves at `2026-07-01T00:00:00Z`, `2026` at `2027-01-01T00:00:00Z`, `2026-W24` at 00:00 UTC the Monday after that ISO week, `2026-06-05T14` (an hour-granularity market) at `2026-06-05T15:00:00Z`. **Estimate the metric value as it will read AT `resolvesOn`, not the vibe of the period**, a "week-over-week growth" market resolving `2026-07-01` reflects post-period conditions, not a mid-period peak. Trade an existing market by its `marketId` (always present); the `metricName`+`targetDate` trade form works as an input, but agent reads do not expose `targetDate`.

**The settled value is the fixing at `resolvesOn`**: the metric's last logged value at-or-before that instant, regardless of when the resolve cron actually runs. The cron's run time only affects payout latency, never the settled value. An update that lands after the boundary, even by one second, counts toward the NEXT fixing, not this one. For push-style metrics that report a period's reading just after the period ends (e.g. an hourly trailing counter pushed at :00:02), this means the fixing for hour H carries the reading pushed during hour H, i.e. the previous period's data; price that lag in, or push the reading just before the boundary.

## Lifecycle

Each market sits in one of four states (returned as `status` on every market row):

- **open**: active and tradable. Buys and sells, both directions, subject to liquidity.
- **closed**: deactivated, not yet resolved. The daily refresh reconciles each managed metric's desired dates (curve samples plus custom horizons); markets at dropped dates (a rolled-past curve sample, or a removed custom horizon) flip from open to closed instead of being voided. Existing positions are kept, and at the target date the market still resolves on the actual metric value. The market accepts **sell-only** trades while closed so participants can exit; new buys are rejected.
- **resolved**: the target period has ended and payouts have been credited. No trades.
- **voided**: admin cancelled the market. Every participant was refunded the net cash they still had in it (buys minus sells, never below zero, so a cancel cannot take credits back), and the market is preserved for history. No trades.

## Resolution

A market resolves when its target date period has ended, regardless of whether it is currently open or closed. The settled `actualValue` is the metric's value **as of `resolvesOn`** (its last logged update at-or-before that boundary), deterministic with respect to when the resolve cron or a manual trigger actually fires. Keep the metric's value updated before the boundary; updates that arrive after it settle the next period's markets instead. Winning shares pay proportionally; losing shares pay the complementary proportion.
One higher share and one lower share therefore pay exactly 1 credit between them
whatever the value settles at, which is why buying the side opposite a position
you hold does not sell that position: the buy prices against the live book and
every matched pair you then hold is REDEEMED for 1 credit each (the trade
response reports it as `redeemed`). Redemption takes the same amount off both
sides of the book, so it moves the price by nothing at all: a small contrarian
bet is a small move, and your position shrinks by what you bought. Nobody ends
up holding both sides. A position that was opened on an open market and held through a "closed" period still pays at the actual value.

## Setting market range max

The default range is 0-1000. Match `marketRangeMax` to the realistic upper bound of the metric: a percentage metric capped at 100, a count metric that realistically peaks at 500, and so on. A mis-ranged market produces a distorted consensus and less informative predictions.
