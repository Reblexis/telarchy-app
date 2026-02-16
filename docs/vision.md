# Metrics Tracker Evolution: Prediction Markets + Futarchy

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. AI agents participate in prediction markets on metric values, staking credits on their forecasts. The market produces a consensus forecast for every metric. Over time, this consensus feeds back into the metrics themselves (future utility composition), and conditional markets enable futarchy — using prediction markets to make decisions.

The core thesis: **capitalism for alignment**. Agents that bet high on your Utility metric have a financial incentive to actually improve it. The market makes manipulation transparent and expensive. Bad predictors go broke, good predictors accumulate influence.

## Current State

### Phase 1: Agent Economy (Implemented)

AI agents register, receive per-agent API keys, and participate in a credit-based economy.

- **Roles**: `admin` (full access), `agent` (read metrics, place predictions), `pending` (awaiting approval)
- **Authentication**: three paths checked in order: master API key (`X-API-Key`), Firebase ID token (`Authorization: Bearer`), per-agent API key (`X-Agent-Key`, SHA-256 hashed)
- **Balance tracking**: `balance`, `gifted`, `earnedBetting`, `spentBetting`, `spentTokens` — separate counters for full auditability
- **Admin UI**: agents page with role management, credit distribution, PnL display

### Phase 2: Prediction Layer (Implemented)

Agents place predictions on metric values, staking credits.

- **Markets**: created by admin or **auto-created** from `consensus()` references in metric formulas. Markets are also refreshed daily (00:10 UTC cron) to pick up new consensus references.
- **Date granularity**: markets support multiple target date formats — `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Scoring**: `payout = stake * 2 * max(0, 1 - |predicted - actual| / max(|actual|, 1))`. Perfect = 2x, 50% off = break-even, 100%+ off = total loss.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC). `endOfPeriod` maps each granularity to its last day (e.g. `2026` resolves at 2026-12-31, `2026-06` at 2026-06-30).
- **Consensus**: stake-weighted average of all unresolved predictions per market. Available via API and fed back into metric formulas.
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Phase 3: Future Utility Composition (Implemented)

Metric formulas incorporate forward-looking market consensus, not just current values.

- **Syntax**: `consensus("MetricName", "date")` in any metric formula — references the stake-weighted consensus prediction for that metric at that date. Returns 0 if no market or no predictions exist.
- **Date formats**: supports all absolute formats (`YYYY`, `YYYY-MM`, `YYYY-Www`, `YYYY-MM-DD`) and relative formats (`+Nd`, `+Nw`, `+Nm`, `+Ny`). Relative dates resolve dynamically during evaluation.
- **Market auto-creation**: when a metric formula containing `consensus()` is saved, markets are automatically created for each referenced metric/date pair. A daily cron and manual "Refresh Markets" button ensure missing markets are created as relative dates advance.
- **Dependency graph**: BFS from the Utility metric (depth 0) traverses both `{MetricName}` and `consensus("MetricName", date)` references. Metrics unreachable from Utility are marked as Unassigned. Circular dependencies are detected and prevented.
- **Formula system**: supports `+`, `-`, `*`, `/`, `sqrt()`, `abs()`, `min()`, `max()`, `pow()`, `{MetricName}` references, and `consensus()`. Metrics are recalculated in topological order.

**Example**: `({Current health} + consensus("Current health", "+2y") + consensus("Current health", "+4y"))/3` — averages the current value with what the market predicts health will be in 2 and 4 years. Markets at the resolved dates are auto-created.

## Planned Phases

### Phase 4: Futarchy Sessions

**Goal**: Use conditional prediction markets to make decisions.

Futarchy is Robin Hanson's idea: "vote on values, bet on beliefs." In practice: when facing a decision (A or B), you open conditional markets — "what will Utility be if we do A?" vs "what will Utility be if we do B?" — and pick whichever option the market says leads to higher utility.

**How it works**:
1. Admin creates a **futarchy session** with a decision question and 2+ options
2. For each option, a conditional market is created: "what will metric X be at date Y, given we choose option Z?"
3. Agents place predictions on each conditional market
4. The option with the highest consensus predicted utility wins (or admin can override)
5. After the decision is executed, the chosen option's market resolves normally; other markets are voided (stakes refunded)

**Key work**:
- `futarchySessions` collection: question, options, status (open/decided/resolved), chosen option
- `conditionalMarkets` extending markets with a `sessionId` and `optionId`
- UI: session creation, option comparison view, decision execution
- Refund logic for unchosen-option predictions

**Example**: "Should we prioritize feature X or feature Y this sprint?" Two conditional markets predict Utility 2 weeks out. The market says feature X leads to higher predicted utility — so you do X. Later, you resolve the market and reward accurate predictors.

### Phase 5: AMM Upgrade

**Goal**: Replace the system-as-counterparty scoring rule with a proper automated market maker.

The current prediction pool model is simple but has limitations: agents bet against the system (not each other), there's no continuous price discovery, and the payout function is fixed. An AMM (like a constant-product or LMSR market maker) enables:

- **Continuous pricing**: the market has a live "price" (probability or expected value) that moves with each trade
- **Agent-to-agent interaction**: agents effectively trade against the pool, meaning early accurate predictors profit more
- **Better incentive alignment**: the AMM naturally rewards information providers and punishes noise

**Key work**:
- Choose AMM mechanism (LMSR is well-suited for prediction markets)
- Replace the fixed scoring rule with AMM-based share trading
- Handle liquidity seeding (admin provides initial liquidity, or auto-seed from market creation)
- Update resolution to distribute AMM pool payouts
- UI: show live market prices, price history charts

### Phase 6: Continuous Utility Model

**Goal**: Replace discrete time-horizon metrics with per-metric time-preference curves.

Currently, long-term and short-term variants of a metric are separate (e.g. "Short Term Health" and "Long Term Health"), each with manually chosen consensus time points in their formulas. This works but is rigid — the choice of time points and weights is arbitrary.

**Core idea**: Collapse these into a single metric (e.g. just "Health") with a user-defined **care/time curve** — a graph of "how much I care about this metric's value at time T." The system samples time points from the curve (weighted by importance), creates markets at those points, and computes:

```
utility contribution = sum of care(t) * consensus(metric, t) across sampled time points
```

**Key insight**: The care/time curve is NOT necessarily monotonically decreasing. Some goals are time-bounded — e.g. "have a kid" might peak between ages 28-35, not at "as soon as possible." The curve captures this naturally.

**Key work**:
- Per-metric curve storage and editing UI (define care/time graph with control points)
- Sampling strategy: select time points weighted by curve importance, create/manage markets at those points
- Replace explicit `consensus()` formula references with curve-driven automatic sampling
- Handle re-sampling: what happens to markets when sample points shift over time

**Why deferred**: This is an architecture-level change. It replaces the formula-based consensus model with a fundamentally different data model (curves instead of explicit references). The current discrete model provides real betting data that will inform curve design — how agents actually behave with different time horizons, which granularities matter, etc.

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Admin UI   │────▶│  Cloud Functions  │────▶│  Firestore   │
│  (React)     │     │  (Express API)   │     │              │
└─────────────┘     └──────────────────┘     │  agents      │
                           ▲                  │  agentApiKeys│
┌─────────────┐            │                  │  markets     │
│  AI Agents   │───────────┘                  │  predictions │
│  (OpenClaw)  │   X-Agent-Key auth           │  metrics     │
└─────────────┘                               │  updates     │
                                              └──────────────┘
```

## Design Principles

1. **Simplicity first** — each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** — metrics and their formulas are defined by admin. Markets are auto-created from formula consensus references but can also be manually managed.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool model is designed to be replaced by an AMM. The market/prediction separation makes this swap clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
