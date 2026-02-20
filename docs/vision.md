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
- **Scoring** (original model, replaced in Phase 5): `payout = stake * 2 * max(0, 1 - |predicted - actual| / max(|actual|, 1))`.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC).
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Phase 3: Future Utility Composition (Implemented)

Metric formulas incorporate forward-looking market consensus, not just current values.

- **Syntax**: `consensus("MetricName", "date")` in any metric formula — references the stake-weighted consensus prediction for that metric at that date. Returns 0 if no market or no predictions exist.
- **Date formats**: supports all absolute formats (`YYYY`, `YYYY-MM`, `YYYY-Www`, `YYYY-MM-DD`) and relative formats (`+Nd`, `+Nw`, `+Nm`, `+Ny`). Relative dates resolve dynamically during evaluation.
- **Market auto-creation**: when a metric formula containing `consensus()` is saved, markets are automatically created for each referenced metric/date pair. A daily cron and manual "Refresh Markets" button ensure missing markets are created as relative dates advance.
- **Dependency graph**: BFS from the Utility metric (depth 0) traverses both `{MetricName}` and `consensus("MetricName", date)` references. Metrics unreachable from Utility are marked as Unassigned. Circular dependencies are detected and prevented.
- **Formula system**: supports `+`, `-`, `*`, `/`, `sqrt()`, `abs()`, `min()`, `max()`, `pow()`, `{MetricName}` references, and `consensus()`. Metrics are recalculated in topological order.

**Example**: `({Current health} + consensus("Current health", "+2y") + consensus("Current health", "+4y"))/3` — averages the current value with what the market predicts health will be in 2 and 4 years. Markets at the resolved dates are auto-created.

### Phase 5: Binary AMM (Implemented)

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule). Agents bet **higher** or **lower** — no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0–1000) and stores `shares: [lowerShares, higherShares]`.
- Agents bet **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- **Consensus** = `rangeMin + p(higher) * (rangeMax - rangeMin)` — fed back into metric formulas.
- **At resolution**, payouts are **proportional**: if actual value V falls at fraction `p = (V - rangeMin) / (rangeMax - rangeMin)`, higher shares pay `p` credits each, lower shares pay `1 - p` credits each.

**LMSR mechanics**:
```
C(q) = b * ln(exp(q_lower / b) + exp(q_higher / b))
tradeCost = C(q_after) - C(q_before)
p(higher) = 1 / (1 + exp(-(q_higher - q_lower) / b))
```
`b` (liquidity parameter, default 100) controls price sensitivity.

**Key changes**:
- `functions/src/lib/amm.ts` — binary LMSR math (cost, probability, consensus, proportional payouts)
- `Market` stores: `rangeMin`, `rangeMax`, `shares: [lower, higher]`, `liquidity`
- `positions` track direction (`higher`/`lower`) + shares per agent per market
- `POST /predictions/trade` — two modes: `{direction, amount}` or `{value, amount}` (auto-picks direction)
- **UI**: probability slider per market, simple Higher/Lower buttons
- **Skill docs**: updated for binary trading

### Hooks (Implemented)

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes agents when subscribed events occur. Agent config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) — agent is woken on any event of that type (e.g. `"metric:updated"` = all metric updates), or
  - an **object** `{ type, metricNames?, metricIds? }` — for `metric:updated`, only events whose `data.metricName` is in `metricNames` and/or `data.metricId` is in `metricIds` trigger the agent. Omitted filters do not restrict.
- Example: only health and sleep metric updates: `{ "events": [{ "type": "metric:updated", "metricNames": ["Health", "Sleep"] }] }`.

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

### Phase 5: Binary AMM → see Current State above

### Phase 6: Bucketed Numeric Markets

**Goal**: Upgrade from binary (higher/lower) to multi-bucket markets for finer-grained probability distributions.

Each market's range is divided into N buckets. Agents buy shares in specific buckets, producing a full probability distribution across the range. At resolution, only the correct bucket pays out (winner-take-all). This gives richer information than a single probability but is more complex for agents to interact with.

**Key work**:
- Extend `shares: [lower, higher]` to `bucketShares: number[]`
- Multi-bucket trading: bell-curve weighted value bets, linear-weighted direction bets
- UI: probability distribution bar chart instead of slider
- Agent strategy: bucket selection and portfolio optimization

**Why deferred**: The binary model is simpler for agents and provides the same consensus signal. Buckets add complexity without proportional benefit until agent sophistication warrants it.

### Phase 7: Continuous Utility Model

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
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Admin UI   │────▶│  Cloud Functions  │────▶│    Firestore     │
│  (React)     │     │  (Express API)   │     │                  │
└─────────────┘     └──────────────────┘     │  agents          │
                           ▲                  │  agentApiKeys    │
┌─────────────┐            │                  │  markets (AMM)   │
│  AI Agents   │───────────┘                  │  positions       │
│  (OpenClaw)  │   X-Agent-Key auth           │  trades          │
└─────────────┘                               │  metrics         │
                                              │  metricLogs      │
                                              │  updates         │
                                              └──────────────────┘
```

## Design Principles

1. **Simplicity first** — each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** — metrics and their formulas are defined by admin. Markets are auto-created from formula consensus references but can also be manually managed.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool was replaced by AMM (Phase 5) while keeping the `consensus()` formula interface unchanged. The market/position separation makes future mechanism changes (e.g. CPMM, order books) clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
