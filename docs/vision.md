# Metrics Tracker Evolution: Prediction Markets + Futarchy

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. AI agents participate in prediction markets on metric values, staking credits on their forecasts. The market produces a consensus forecast for every metric. Metrics with time preference enabled automatically incorporate these forward-looking consensus values via a decay-weighted temporal aggregation, and conditional markets enable futarchy — using prediction markets to make decisions.

The system is general-purpose: it works equally for an individual tracking personal health/career/life metrics and for an organization tracking business KPIs, OKRs, or any other quantified objectives. The Utility metric is whatever you define it to be — personal wellbeing, company revenue, product quality, or any composite goal.

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

### Phase 3: Future Utility Composition (Implemented — being superseded by Phase 7)

> **Deprecation notice**: The `consensus()` formula syntax and formula-driven market auto-creation described below are being replaced by the **Time Preference System** (Phase 7). In the new model, forward-looking evaluation is a per-node property rather than inline formula calls. See Phase 7 for the target architecture.

Metric formulas incorporate forward-looking market consensus, not just current values.

- **Syntax**: `consensus("MetricName", "date")` in any metric formula — references the stake-weighted consensus prediction for that metric at that date. Returns 0 if no market or no predictions exist.
- **Date formats**: supports all absolute formats (`YYYY`, `YYYY-MM`, `YYYY-Www`, `YYYY-MM-DD`) and relative formats (`+Nd`, `+Nw`, `+Nm`, `+Ny`). Relative dates resolve dynamically during evaluation.
- **Market auto-creation**: when a metric formula containing `consensus()` is saved, markets are automatically created for each referenced metric/date pair. A daily cron and manual "Refresh Markets" button ensure missing markets are created as relative dates advance.
- **Dependency graph**: BFS from the Utility metric (depth 0) traverses both `{MetricName}` and `consensus("MetricName", date)` references. Metrics unreachable from Utility are marked as Unassigned. Circular dependencies are detected and prevented.
- **Formula system**: supports `+`, `-`, `*`, `/`, `sqrt()`, `abs()`, `min()`, `max()`, `pow()`, `{MetricName}` references, and `consensus()`. Metrics are recalculated in topological order. Under Phase 7, `consensus()` is removed — formulas use only `{MetricName}` references and math operators.

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
  - a **string** (event type) — agent is woken on any event of that type (e.g. `"market:resolved"` = all resolutions), or
  - an **object** `{ type, metricNames?, metricIds? }` — filter by metric name/id. Supported for all event types that carry `metricName`/`metricId` in their payload: `metric:updated`, `market:resolved`, `market:created`, `trade:executed`. Omitted filters do not restrict.
- Example: only sleep metric updates and resolutions:
  ```json
  { "events": [
    { "type": "metric:updated", "metricNames": ["Current sleep quality", "Current sleep duration"] },
    { "type": "market:resolved", "metricNames": ["Current sleep quality"] }
  ] }
  ```

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

Each market's range is divided into N buckets. Agents buy shares in specific buckets, producing a full probability distribution across the range. At resolution, only the correct bucket pays out (winner-take-all). This gives richer information than a single probability but is more complex for agents to interact with. Under Phase 7, bucketed markets would apply to the leaf-node markets created by the time-preference system.

**Key work**:
- Extend `shares: [lower, higher]` to `bucketShares: number[]`
- Multi-bucket trading: bell-curve weighted value bets, linear-weighted direction bets
- UI: probability distribution bar chart instead of slider
- Agent strategy: bucket selection and portfolio optimization

**Why deferred**: The binary model is simpler for agents and provides the same consensus signal. Buckets add complexity without proportional benefit until agent sophistication warrants it.

### Phase 7: Time Preference System

**Goal**: Replace `consensus()` formula calls (Phase 3) with a per-node **time preference** property that automatically handles forward-looking evaluation and market creation.

#### Motivation

Phase 3 embeds time horizons directly in formulas via `consensus("MetricName", "date")`. This is fragile: the choice of time points and weights is arbitrary, every formula that cares about the future must manually list consensus references, and adding a new time horizon means editing formulas. The Time Preference System separates the temporal dimension from the formula, making it a toggleable property of the node itself.

#### Core Model

- **Time preference** is a per-node toggle, not part of the formula. When enabled, the node gains a **decay function** that defines how much future values matter relative to the present.
- **Formulas stay simple**: only `{MetricName}` references and math. No `consensus()` calls. The formula describes the *structural relationship* between metrics; time preference handles the *temporal weighting*.
- **Initial curve type**: exponential decay with a configurable **half-life** parameter. `weight(t) = e^(-λt)` where `λ = ln(2) / half_life`. More complex curve types (e.g. control-point graphs for time-bounded goals) are planned for later.

#### Computation

When a node has time preference enabled:

1. The system **samples time points** from the decay curve (including `t=0` for the present).
2. For each time point `t`, the node's formula subtree is evaluated using **consensus predictions of leaf values at `t`**. At `t=0`, actual current values are used.
3. The node's value is the **weighted aggregate**, normalized by total weight:

```
value = sum(weight(t_i) * formula_eval_at_t_i) / sum(weight(t_i))
```

Non-leaf intermediate nodes in the subtree need no markets — their future values are computed deterministically from their static formulas given predicted leaf values.

#### Market Spawning Rules (Static Definition Model)

All formulas and metric definitions are treated as **static**:

- **Definition** = name, description, formula, and (for non-leaf nodes) base value. Any change to a metric's definition triggers a **full respawn** of all markets under the affected time-preference subtree.
- **Leaf nodes** (metrics with no formula or `formula = "0"`) are the only nodes whose base value can change without it being a definition change. Their base value is what evolves over time and what agents bet on.
- **Markets are created only for leaf nodes**, at the time points sampled by their ancestor's time-preference curve. No markets for intermediate formula nodes.
- When a time-preference curve's sampled points shift (e.g. daily roll of relative time points), new markets are created and expired ones resolve normally.

#### Constraints

- **One time-preferenced node per path**: on any path from root (Utility) to any leaf, at most one node may have time preference enabled. Enabling time preference on a node fails if any ancestor or descendant on any shared path already has it.
- **Descendants describe current state**: all metrics below a time-preferenced node must represent the present, not future prospects. The time-preferenced node handles the forward-looking aspect for its entire subtree.

#### Example

```
Utility (depth 0, formula: {Health} + {Career})
├── Health (depth 1, TIME PREFERENCE: half-life=2y, formula: {Sleep} + {Exercise})
│   ├── Sleep (leaf, depth 2) ← markets at sampled time points
│   └── Exercise (leaf, depth 2) ← markets at sampled time points
└── Career (depth 1, TIME PREFERENCE: half-life=5y, formula: {Income} + {Satisfaction})
    ├── Income (leaf, depth 2) ← markets at sampled time points
    └── Satisfaction (leaf, depth 2) ← markets at sampled time points
```

Health's value at half-life=2y: the system samples e.g. now, +6m, +1y, +2y, +4y. For each time point, it evaluates `Sleep_at_t + Exercise_at_t` using market consensus for the leaves. The weighted aggregate becomes Health's total. Career works the same way with its own half-life.

Utility itself has no time preference — it simply sums the already-time-weighted Health and Career values.

#### Key Work

- `Metric` gains optional `timePreference: { enabled: boolean, halfLife: number }` (duration in years)
- Sampling strategy: select time points from the decay curve at reasonable intervals, create markets for all leaf descendants at those points
- Constraint enforcement: validate the one-per-path rule when toggling time preference
- Replace `consensus()` formula evaluation and market auto-creation with curve-driven market spawning
- Definition-change detection: compare metric snapshots to detect definition changes and trigger market respawn
- UI: per-metric time-preference toggle with half-life slider/input

#### Future Extensions

- Additional curve types beyond exponential decay (e.g. control-point graphs for time-bounded goals like "have a kid" peaking at ages 28-35)
- Adaptive sampling: denser time points where the curve changes rapidly
- Visualization of the time-preference curve and its sampled points in the admin UI

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
2. **Admin control** — metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool was replaced by AMM (Phase 5), and `consensus()` formula calls are being replaced by per-node time preference (Phase 7). The market/position separation makes future mechanism changes (e.g. CPMM, order books) clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
6. **Static definitions** — formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely — this is what agents bet on.
