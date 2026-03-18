# Telarchy: Prediction Markets + Futarchy

## Name

*Telarchy* combines **telos** (Greek: ultimate purpose, end goal) and **-archy** (Greek: governance, rule). Governance by purpose — a system where everything is organized around and judged against a defined end goal.

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. AI agents participate in prediction markets on metric values, staking real money on their forecasts. The market produces a consensus forecast for every metric. Metrics with time preference enabled automatically incorporate these forward-looking consensus values via a decay-weighted temporal aggregation, and conditional markets enable futarchy — using prediction markets to make decisions.

The system is general-purpose: it works equally for an individual tracking personal health/career/life metrics and for an organization tracking business KPIs, OKRs, or any other quantified objectives. The Utility metric is whatever you define it to be — personal wellbeing, company revenue, product quality, or any composite goal.

The core thesis: **capitalism for alignment**. Agents that bet high on your Utility metric have a financial incentive to actually improve it. The market makes manipulation transparent and expensive. Bad predictors go broke, good predictors accumulate capital.

## Current State

### Phase 1: Agent Economy (Implemented)

AI agents register, receive per-agent API keys, and participate in a real-stakes economy.

- **Roles**: `admin` (full access), `agent` (read metrics, place predictions), `pending` (awaiting approval)
- **Authentication**: three paths checked in order: master API key (`X-API-Key`), Firebase ID token for an allowlisted admin email or admin custom claim (`Authorization: Bearer`), per-agent API key (`X-Agent-Key`, SHA-256 hashed)
- **Balance tracking**: `balance`, `gifted`, `earnedBetting`, `earnedTasks`, `spentBetting`, `spentTokens` — separate counters for full auditability
- **Admin UI**: agents page with role management, credit distribution, PnL display

### Phase 2: Prediction Layer (Implemented — AMM model in Phase 5)

Agents place predictions on metric values, staking credits.

- **Markets**: created by admin or auto-created from time-preference curves. Markets are also refreshed daily (00:10 UTC cron).
- **Date granularity**: markets support multiple target date formats — `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC).
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Phase 3: Future Utility Composition (Superseded by Phase 7)

> **Deprecation notice**: The `consensus()` formula syntax and formula-driven market auto-creation described below have been replaced by the **Time Preference System** (Phase 7). In the new model, forward-looking evaluation is a per-node property rather than inline formula calls.

Metric formulas incorporated forward-looking market consensus, not just current values.

- **Syntax**: `consensus("MetricName", "date")` in any metric formula — references the stake-weighted consensus prediction for that metric at that date.
- **Formula system**: supported `+`, `-`, `*`, `/`, `sqrt()`, `abs()`, `min()`, `max()`, `pow()`, `{MetricName}` references, and `consensus()`. Under Phase 7, `consensus()` is removed — formulas use only `{MetricName}` references and math operators.

### Phase 4: Tasks and Conditional Decision Markets (Implemented)

Agents propose tasks with a price (credits they receive if approved). The system evaluates each proposal by running the existing prediction markets conditionally against it.

**How it works**:
1. Agent calls `POST /api/tasks` with `{ title, description, price }`.
2. When an agent or admin fetches markets with `?taskId=<id>`, the system auto-creates **conditional markets** — clones of all currently active leaf-metric markets, starting with zero positions, tagged with the `taskId`.
3. Agents bet on conditional markets to signal expected impact: "what will metric X be if this task is completed?"
4. Admin views the task detail, which shows: conditional consensus vs baseline consensus for every market, and an expected Utility delta computed from the conditional forecasts.
5. **Approve** — proposing agent receives `price` credits (tracked in `earnedTasks`); conditional markets remain and resolve normally.
6. **Decline** — conditional markets are voided; all bettor stakes are fully refunded.

A per-task message thread (`tasks/{taskId}/messages`) enables agent-admin negotiation before a decision is made.

Admin can also refresh conditional markets at any time to pick up newly created base markets.

### Phase 5: Binary AMM (Implemented)

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule). Agents bet **higher** or **lower** — no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0–1000) and stores `shares: [lowerShares, higherShares]`.
- Agents bet **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- Agents can also **sell** existing positions back to the AMM at current prices.
- **Consensus** = `rangeMin + p(higher) * (rangeMax - rangeMin)` — fed back into metric formulas.
- **At resolution**, payouts are **proportional**: if actual value V falls at fraction `p = (V - rangeMin) / (rangeMax - rangeMin)`, higher shares pay `p` credits each, lower shares pay `1 - p` credits each.

**LMSR mechanics**:
```
C(q) = b * ln(exp(q_lower / b) + exp(q_higher / b))
tradeCost = C(q_after) - C(q_before)
p(higher) = 1 / (1 + exp(-(q_higher - q_lower) / b))
```
`b` (liquidity parameter — admin injects liquidity to enable trading) controls price sensitivity.

**Key details**:
- `Market` stores: `rangeMin`, `rangeMax`, `shares: [lower, higher]`, `liquidity`
- `positions` track direction (`higher`/`lower`) + shares per agent per market
- `POST /predictions/trade` — two modes: `{direction, amount}` or `{value, amount}` (auto-picks direction based on which side the value falls)
- **UI**: probability slider per market, Higher/Lower buttons

### Phase 7: Time Preference System (Implemented)

Replaces `consensus()` formula calls with a per-node **time preference** property that automatically handles forward-looking evaluation and market creation.

**Core model**:
- `timePreference: { enabled: boolean, halfLife: number }` is an optional field on any metric.
- When enabled, the node's value is a decay-weighted blend of: the current value (at t=0) plus market consensus values at 10 sampled future time points.
- **Formulas stay simple**: only `{MetricName}` references and math. No `consensus()` calls.
- **Sampling**: 10 quantile-midpoint samples from an exponential distribution with the given `halfLife` (in years). Each sample covers equal probability mass; weights are uniform. The median sample falls at `t = halfLife`.
- **Date granularity** of sampled time points adapts to distance: `YYYY-MM-DD` (< 1 week), `YYYY-Www` (< 1 month), `YYYY-MM` (< 1 year), `YYYY` (≥ 1 year).
- **Markets** are created only for leaf nodes (metrics with no formula), at the time points sampled by their ancestor's time-preference curve.

**Computation**:
```
value = sum(weight(t_i) * formula_eval_at_t_i) / sum(weight(t_i))
```
Non-leaf intermediate nodes in the subtree are evaluated deterministically from their formulas given predicted leaf values — no markets needed for them.

**Constraints**:
- **One time-preferenced node per path**: on any path from root (Utility) to any leaf, at most one node may have time preference enabled.
- **Descendants describe current state**: all metrics below a time-preferenced node must represent the present; the TP node handles the forward-looking aspect for its entire subtree.

**Market lifecycle**:
- The daily cron (00:10 UTC) and "Refresh Markets" button compute the desired `(leafId, targetDate)` set and create missing markets.
- Markets falling out of the desired set are set `active: false` but resolve normally rather than being voided.
- A Firestore distributed lock (`_system/marketRefreshLock`, 2-minute TTL) prevents duplicate creation from concurrent refresh calls.

**Example**:
```
Utility (formula: {Health} + {Career})
├── Health (TIME PREFERENCE: half-life=2y, formula: {Sleep} + {Exercise})
│   ├── Sleep (leaf) ← markets at sampled time points
│   └── Exercise (leaf) ← markets at sampled time points
└── Career (TIME PREFERENCE: half-life=5y, formula: {Income} + {Satisfaction})
    ├── Income (leaf) ← markets at sampled time points
    └── Satisfaction (leaf) ← markets at sampled time points
```

### Agent Economy Parameters (Implemented)

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the `_system/economy` Firestore document. Admin sets this; agents use it to understand the real-money value of their balance.

**Credit model**: 1 credit = `creditValueUsd` USD. Credits go up from admin gifts, winning bets, and approved task proposals. Credits go down from losing bets (automatic through AMM) and voluntary agent purchases — agents can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

### Hooks (Implemented)

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes agents when subscribed events occur. Agent config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) — agent is woken on any event of that type, or
  - an **object** `{ type, metricNames?, metricIds? }` — filter by metric name/id.

### Metrics Graphing System (Implemented)

The Metrics tab uses a single Chart.js graph engine for both inline card charts and the expanded graph modal.

- **Shared renderer**: inline and modal charts rendered by the same `MetricsTimeChart` component.
- **Unified date model**: mixed target date formats normalized into canonical timestamps before plotting.
- **Axis behavior**: x-axis labels adaptive to visible time span, y-axis labels use deterministic numeric formatting.
- **Interaction**: inline charts support hover/click-to-expand; modal charts support tooltip inspection and x-axis pan/zoom.

## Planned Phases

### Time Preference Future Extensions

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
                                              │  tasks           │
                                              │  waitlist        │
                                              └──────────────────┘
```

## Design Principles

1. **Simplicity first** — each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** — metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool was replaced by AMM (Phase 5), and `consensus()` formula calls were replaced by per-node time preference (Phase 7). The market/position separation makes future mechanism changes (e.g. CPMM, order books) clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
6. **Static definitions** — formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely — this is what agents bet on.
