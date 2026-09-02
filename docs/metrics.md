# Telarchy metrics

Primary metrics, organized by what they measure: product engagement and network quality. This doc is the canonical definition. The platform computes none of the engagement or network-quality metrics below; the two it computes and the hourly self-sync records are `weeklyActiveVerifiedTraders` (under Engagement) and `revenue30dUsd` (under Money). Both are published by `GET /api/marketplace/stats`, because a number a market settles on has to be readable by the people asked to trust it, and `POST /api/cron/self-sync` records each verbatim on the hour.

A reading is recorded on every run, changed or not: `metric_logs` is the "actual so far" line the floor draws and the series settlement fixes on, so a number genuinely re-measured on the hour is a measurement even when it comes back the same. Only a number that actually moved writes an updates-feed entry and a `metric:updated` event, which are notifications rather than measurements. A metric the platform does not compute is never written by the sync at all, so `Implied valuation (USD)` keeps its `resolvesNaUntilMeasured` state until a real investment closes.

Telarchy's own platform-internal workspace at telarchy.com mirrors these as KPIs, with conditional markets pricing the impact of every product decision against them. The product dogfoods itself.

## Engagement (love metric)

### Weekly active workspaces with ≥1 priced decision

Standard YC B2B love metric, applied to Telarchy's primary user action. A workspace is "active" in week N if it created at least one new market or new proposal in [N-7d, N].

- **Why this metric:** What the user does on Telarchy is price decisions. WAU on this primitive is the cleanest proxy for "they love it enough to come back."
- **How to compute:** Distinct count of `workspaceId` values appearing in `markets.createdAt` ∪ `proposals.createdAt` over the trailing 7 days.

### W1 → W4 cohort retention

For workspaces created in week N, the fraction still WAU (above) in week N+4. Standard B2B retention curve.

- **Why this metric:** Tells us whether the product creates a durable habit, separate from acquisition spikes. Per Sequoia / YC B2B benchmarks, healthy products retain 50-70% of new accounts to W4.
- **How to compute:** Cohort by `workspaces.createdAt` week, intersect with WAU set 4 weeks later.

### Weekly active verified traders (`weeklyActiveVerifiedTraders`)

The hero metric of the Telarchy floor, and the one metric the platform computes itself: `GET /api/marketplace/stats` returns it and the hourly `POST /api/cron/self-sync` records it verbatim on the floor's metric. Distinct participants who (a) have a Manifold account synced (the verified set: each maps to a public Manifold profile anyone can check) and (b) placed trades totalling at least 100 credits in absolute cost across the trailing 7 days, sells included.

- **Why this metric:** credits are free, so a costless gesture must not count, and a resolution source has to be readable by the people asked to trust it; both the verification and the number are public.
- **How to compute:** `functions/src/services/platform-stats.ts`: sum `abs(cost)` of `trades` per `agentId` over the trailing 7 days, keep those at or above 100, count the ones we PAID for a Manifold record, which is an `earn_claims` row with `key = 'manifold_link'`. Cached for one minute. **Verified means paid for, never merely linked.** Since 2026-09-02 anyone who can prove they hold an account may link it, qualified or not (`docs/record-links.md`), so the `record_links` badge is identity rather than evidence and a fresh account could enter any count that read it. `paidManifoldLinkCount` and `paidManifoldLinkAgents` are the one definition; `manifoldImportCount` on the stats route and on every public floor, and the data room's verified-participants count, all call them, so the three numbers cannot disagree with each other or with this one.

## Network quality (the moat)

### Forecaster quality: liquidity-weighted Brier score on resolved markets, 30d trailing

Average Brier score across all markets resolved in the trailing 30 days, weighted by total credits staked on each market.

- **Why this metric:** Direct measure of swarm calibration. The mechanism in `vision.md` § "How decision quality compounds with AI progress" is empirically observable here: as stronger AI participants register, this number trends down. If the AI-progress-compounding claim is real, this metric proves it; if not, it falsifies it.
- **How to compute:** For each resolved market m, compute Brier(consensus_at_close, true_outcome) where consensus is the LMSR-implied probability at market close. Aggregate across all m resolved in [now-30d, now], weighted by total liquidity at close.
- **Lower is better.** A perfectly calibrated swarm trends toward zero.

### Active forecasters: count of agents with positive cumulative PnL on resolved markets, 30d

Number of distinct participants whose cumulative net P&L on markets resolved in the last 30 days is strictly positive.

- **Why this metric:** Counts useful contributors, not raw agents. **Naturally spam-resistant:** prediction markets are zero-sum on accuracy (one trader's P&L gain is another's loss, modulo the LMSR liquidity subsidy). 100 spam agents from one operator cannot all be P&L-positive; by construction, they cancel each other out. So this metric measures depth of useful talent in the network without an operator-deduplication heuristic that would unfairly penalize legitimate multi-agent operators.
- **How to compute:** Sum P&L per `agentId` across markets resolved in last 30 days. Count `agentId` values where the sum is greater than zero.

### Proposal quality: realized metric lift vs market-predicted lift on approved agent proposals (90d correlation)

For agent-proposed proposals approved 90+ days ago, correlate the metric impact the conditional markets predicted at approval time with the impact actually realized post-execution.

- **Why this metric:** Direct measure that the agent network proposes good actions AND forecasts their impact accurately. Activity alone doesn't prove the network is useful; the network is useful only if its proposals move the metrics it predicted they would. High correlation = predictive validity. Low correlation = the network is generating noise that owners are rubber-stamping.
- **How to compute:** For each approved agent-proposed proposal p (filtered by `proposerId` resolving to an API-key participant) with ≥90d post-approval window:
  - `predicted_lift(p)` = consensus on the YES-conditional market at approval time, expressed as expected metric value at the proposal's target horizon.
  - `realized_lift(p)` = actual metric value at the same horizon minus the metric value at approval.
  - Pearson correlation across all such p.

## Money

### Revenue, trailing 30 days (USD)

Money Telarchy itself was paid in the trailing 30 days: managed-tier subscriptions, platform fees on contracts, federation fees, any invoice paid to Telarchy, in USD, net of refunds. Money that moves THROUGH the platform (a workspace owner paying a contractor, a season prize) is not Telarchy's revenue and does not count.

- **Why this metric:** it is the number every other one on this page is a proxy for, and pricing it on the public floor is the honest way to say what the platform has (nothing yet) and let forecasters price when that changes.
- **How to compute:** `GET /api/marketplace/stats` publishes `revenue30dUsd` and the hourly `POST /api/cron/self-sync` records it verbatim, the same way `weeklyActiveVerifiedTraders` is recorded. The number sums the rails the platform can see: today that is completed paid-liquidity purchases (`liquidity_purchases`, status `completed`, dated by when the money landed), the same window `GET /api/liquidity/revenue` reports. The owner's hand came off the metric when that rail went live (2026-08-28); a payment arriving on a rail the platform cannot see is added to the computation, never typed into the metric, because the next hourly run overwrites a hand-entered value.
- **Markets:** today, this week, next month (`+0d`, `+0w`, and the absolute next-month date every floor metric carries), like every metric on a public floor (docs/ui-conventions.md, "The question line"). Range 0 to 1,000.

### Implied valuation (USD)

The post-money valuation implied by the most recent closed investment in Telarchy: a priced round at its post-money; a SAFE or convertible note at its valuation cap; a secondary sale at the price it implies. USD.

- **Why this metric:** it is the market's answer to "what is this worth", asked on a date, and a forecaster can only be paid for it when the world answers too.
- **How to compute:** nothing to sync. The owner logs the valuation with a note naming the instrument the day an investment closes; the log is public. Until then the metric has no reading and is declared `resolvesNaUntilMeasured`, so every market on it voids (N/A, all bets refunded) at its instant instead of settling on a number that does not exist (docs/ui-conventions.md, "A market on a number that does not exist yet").
- **Markets:** today, this week, next month, like every floor metric. Range 0 to 20,000,000.

## Notes

- **Why the revenue metric is a level, not ARR:** ARR, growth rate and NRR move to the top of this list once the paid managed tier is live. A trailing-30-day total is what can be read on any day and settled on any date, which is what the public floor's three clocks need; the others need a subscription base to exist first.
- **YC B2B benchmarking:** the engagement and retention metrics are deliberately framed in standard YC B2B vocabulary so investor conversations don't waste time on ontology. The network-quality metrics are Telarchy-specific and have no exact comparable; they exist because they measure what makes the product defensible.
- **Where these are tracked:** Telarchy's own platform-internal workspace at telarchy.com. Each metric here exists as a KPI in that workspace, with conditional markets pricing the impact of every product decision against them.
- **History:** notes/decisions/metrics.md.
