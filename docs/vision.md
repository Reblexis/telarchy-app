# Telarchy: Prediction Markets + Futarchy

## Name

*Telarchy* combines **telos** (Greek: ultimate purpose, end goal) and **-archy** (Greek: governance, rule). Governance by purpose — a system where everything is organized around and judged against a defined end goal.

**Relation to futarchy.** Futarchy (Robin Hanson, 2000) is the system this builds on: "vote on values, bet on beliefs." Its mechanism — conditional prediction markets that evaluate proposals against a welfare metric — is structurally identical to what telarchy uses. The one difference: futarchy requires a vote to define the welfare metric, because it was designed for groups that disagree on values. Telarchy removes that step. The owner defines the Utility metric directly. No voting, no aggregation. This makes the same mechanism usable by individuals, companies, and governments alike — wherever one party can define the goal unilaterally.

The name reflects this: futarchy foregrounds the *mechanism* (markets, the future decides); telarchy foregrounds the *goal* (the telos is given). The closest existing category is **decision markets** — conditional prediction markets that execute decisions rather than merely forecast. Telarchy is a decision market system with three additions not found elsewhere: a hierarchical metric tree where Utility composes from sub-metrics via formulas, an agent proposal economy where agents propose tasks and earn for approved ones, and a time preference system for forward-looking evaluation.

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. Agents participate in prediction markets on metric values, staking real money on their forecasts. The market produces a consensus forecast for every metric. Metrics with time preference enabled automatically incorporate these forward-looking consensus values via a decay-weighted temporal aggregation, and conditional markets enable the core decision loop.

The system is general-purpose: it works equally for an individual tracking personal health/career/life metrics and for an organization tracking business KPIs, OKRs, or any other quantified objectives. The Utility metric is whatever you define it to be — personal wellbeing, company revenue, product quality, or any composite goal.

**Agent** means any market participant — human or AI. A consultant, employee, or automated system can all register, propose tasks, and bet. The economic logic applies equally to all.

The core thesis: **capitalism for alignment**. Alignment works through the task proposal cycle: an agent proposes an action with a price, conditional markets reveal its expected impact on Utility, and the owner approves or declines based on the forecast delta. Agents whose proposals consistently move Utility in the right direction accumulate earnings; agents whose proposals don't survive conditional evaluation go broke. The market makes manipulation transparent and expensive — a bad proposal is rejected not by opinion but by the crowd's money.

## Metrics vs Tasks

The distinction between metrics and tasks is foundational.

**Metrics** are definitional commitments. A metric declares that some quantity *certainly* affects your utility in a known way. If you later find the metric was wrong — that you measured the wrong thing — that is a definition error, not a system failure, and the system cannot fix it for you. The practical implication: define metrics at the level of abstraction you are genuinely certain about, and keep them as subjective as necessary. A self-reported *Happiness* score is often a better leaf metric than *Dopamine level*, because the link between dopamine and subjective happiness is uncertain.

> **Example.** Suppose you define Happiness as dopamine level, then start taking drugs. Your dopamine metric rises; you are still unhappy. The system has done nothing wrong — it optimized exactly what you asked. The error was in the definition. The correct approach: keep *Happiness* as the metric (self-reported), and create a task — *"Will increasing dopamine improve my subjective happiness?"* — evaluated via conditional prediction markets before committing.

**Tasks** are hypothesis tests. Any time you are uncertain whether an action will improve a metric, that uncertainty belongs in a task, not in the metric definition. Conditional markets answer the question "what would Utility look like if this task were completed?" and the crowd's money resolves the uncertainty.

## Multi-workspace and domain metrics

Telarchy workspaces are composable. A common pattern: one personal workspace defining personal Utility, and one or more domain workspaces (a startup, a project, a team) with their own metric trees.

The connection between startup metrics and personal utility is often uncertain. How much does the startup's user count correspond to personal wealth? To social capital? These are empirical questions, not definitional ones — they should not be hardwired into the personal Utility formula. Instead:

- Treat the startup workspace as an information source. Agents observing both workspaces can use startup metrics as signal when proposing tasks and placing bets in the personal workspace.
- Use tasks to test the connection. A task such as *"Will growing MAU by 20% improve my personal Utility?"* lets conditional markets evaluate the hypothesis before you commit resources.

This keeps the two workspaces decoupled at the definition level while still allowing agents to reason across them.

**Why maintain a separate domain workspace at all?**

1. **Agent information** — domain metrics (revenue, retention, velocity) give agents richer signal to reason about how to improve personal utility, without being hardcoded as direct inputs to the personal Utility formula.
2. **Privacy** — the personal utility workspace may contain sensitive self-assessments. The startup workspace can be shared with employees, investors, or the public without exposing personal data.
3. **Multi-stakeholder** — multiple shareholders can co-own a startup workspace and independently evaluate its impact on their respective personal utilities. The exact coordination mechanism for this is an open design question.

## Current State

### Phase 1: Agent Economy (Implemented)

AI agents register, receive per-agent API keys, and participate in a real-stakes economy.

- **Roles**: `admin` (full access), `agent` (read metrics, place predictions). No `pending` state — agents are auto-approved on registration.
- **Authentication**: three paths checked in order: master API key (`X-API-Key`), Firebase ID token for an allowlisted admin email or admin custom claim (`Authorization: Bearer`), per-agent API key (`X-Agent-Key`, SHA-256 hashed). Google and GitHub OAuth are also supported via Firebase popup.
- **Balance tracking**: `balance`, `gifted`, `earnedBetting`, `earnedTasks`, `spentBetting`, `spentTokens` — separate counters for full auditability
- **Zero-sum economy**: Every credit in the system is backed 1:1 by USDC held in the treasury. Credits are created only via `POST /agents/:id/deposit` (USDC → credits). Admin-to-agent transfers (`POST /agents/:id/credit`) are pure balance transfers requiring `fromAgentId` — no credit creation from thin air. All agents (including the system admin account) start at zero and must deposit USDC to participate.
- **Global balance**: An agent's balance lives on their account document (`agents/{agentId}`) — it is not scoped to any workspace. Each agent has exactly one account with one credit balance usable across the system.. **Balances are stored as integer nanocredits** (1 credit = 1,000,000,000 units) to eliminate IEEE 754 float drift. All reads go through `fromUnits()`, all writes use `toUnits()` + integer `FieldValue.increment()`.
- **Admin UI**: agents page with admin badge from role field, credit distribution, PnL display. Role is managed via the Admin permission group (see below), not a direct dropdown.

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

### Phase 1b: Permission Groups (Implemented)

Per-metric access control via a `permissionGroups` workspace subcollection.

- **Types**: `public` (all agents implicitly member), `admin` (grants full access), `custom`.
- **System groups**: `Public` and `Admin` are bootstrapped on workspace creation and cannot be renamed or deleted.
- **Unified access model**: Groups have both `agentIds[]` (AI agents) and `uids[]` (Firebase users). Adding any identity to the Admin group grants admin-level workspace access; adding to any other group grants trader-level access. There is no separate "members" concept — permission groups are the single source of truth.
- **Admin group sync**: adding an agent to Admin sets `agent.role = 'admin'`; adding a user UID writes `users/{uid}.workspaces[wsId] = { role: 'admin' }` for the discovery index. Removal cleans up accordingly.
- **Custom groups**: hold an explicit `agentIds[]` and a `permissions` map of `metricId → { read: boolean, trade: boolean }` for fine-grained market access.
- **API**: `GET/POST /groups` (agent-readable, admin-writable), `PUT/DELETE /groups/:id`.

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

**LP accounting**: liquidity providers are charged only `poolIncrease` (what actually enters the pool), not the full liquidity parameter — prevents ~30% overcharge on fresh markets. At resolution and void, any pool leftover is distributed back to LPs proportionally based on `poolContribution` recorded in `liquidityEvents`.

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

**Tree zone model** — the TP node divides the metric tree into two zones with distinct roles:
- **Above the TP node** (Utility and any intermediate nodes higher up): purely compositional. These metrics combine TP-blended children via formulas and are forward-looking as a result. They don't interact with markets directly.
- **Below the TP node** (leaf metrics and intermediate computed metrics in the subtree): represent the *current state only*. Leaves are updated directly; computed nodes below TP evaluate deterministically from current values. The TP node above them handles all temporal expansion.

Every leaf metric should have a TP-enabled ancestor. A leaf without one contributes only a static current value to Utility — no markets are created for it, no forecast signal is generated, and the temporal dimension of the system is lost for that branch.

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

### Phase 8: USDC Settlement on Base (Implemented)

Credits are backed by real USDC. A treasury wallet on the Base L2 network holds the USDC reserve. Agents register a Base wallet address and can withdraw their credit balance as on-chain USDC at any time.

**Settlement model**:
- Internal credit transfers (betting, task payouts, gifting) remain purely off-chain — no gas fees.
- On-chain settlement only happens at withdrawal time, keeping fees negligible (~$0.001/tx on Base).
- Conversion rate: `creditValueUsd` from `_system/economy` determines how many USDC a credit is worth.

**API**:
- `PUT /api/agents/:id/wallet` — register or update a Base wallet address (self or admin).
- `POST /api/agents/:id/withdraw` — body `{ amount }`: deducts `amount` credits, sends `amount * creditValueUsd` USDC on-chain. Atomically re-credits on tx failure.
- `GET /api/agents/treasury` — admin only: returns treasury address and current USDC balance.

**Audit trail**: every withdrawal is recorded in the `withdrawals` collection with `{ agentId, credits, usdcAmount, toAddress, txHash, createdAt }`.

**Credit purchase (open to anyone)**:
- Admin publishes the treasury address via `GET /api/agents/treasury`.
- Anyone sends USDC to the treasury on Base, then calls `POST /api/agents/:id/deposit` with the tx hash.
- Backend verifies the transfer on-chain (reads the Transfer event, checks recipient = treasury).
- Credits issued: `floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100)))`.
- The fee surplus stays in the treasury — the system is self-sustaining: total USDC held ≥ credits outstanding × creditValueUsd at all times.
- Each tx hash is stored in the `deposits` collection and rejected if reused (double-spend prevention).

**Economy parameters** (set in `_system/economy`):
- `creditValueUsd` — USD value of 1 credit (also used for withdrawal conversion).
- `buyFeePercent` — fee percentage added on top when buying credits (default 0). E.g. 5 means 105 USDC → 100 credits.

**Setup**: set `TREASURY_PRIVATE_KEY` (hex, `0x`-prefixed) in Firebase Functions config. The treasury wallet must hold sufficient USDC on Base mainnet.

### Agent Economy Parameters (Implemented)

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the `_system/economy` Firestore document. Admin sets this; agents use it to understand the real-money value of their balance.

**Credit model**: 1 credit = `creditValueUsd` USD. The system is strictly zero-sum — total credits in circulation always equal total USDC in the treasury divided by `creditValueUsd`. Credits enter the system only via USDC deposit (`POST /api/agents/:id/deposit`); they leave only via USDC withdrawal (`POST /api/agents/:id/withdraw`). Internal flows (betting wins/losses, task payouts, agent-to-agent transfers) are purely redistributive. Credits go down from losing bets (automatic through AMM) and voluntary agent purchases — agents can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

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

## Navigation

The app uses a persistent left sidebar (`Sidebar.tsx` + `AppLayout.tsx`) for all authenticated pages. The sidebar handles workspace switching (all workspaces listed, click to switch), workspace-scoped nav (Metrics, Markets, Tasks, Agents), platform nav (Marketplace, Account, Guides), and logout. The horizontal header (`Header.tsx`) is kept only for the agent portal. `/account` shows agents and balances, and links to the Agent Portal for USDC deposit/withdrawal.

`/guides` is a publicly accessible in-app reference covering metric structure, formula syntax, time preference, markets, and the task decision loop. No auth required.

## Design Principles

1. **Simplicity first** — each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** — metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** — all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** — the prediction pool was replaced by AMM (Phase 5), and `consensus()` formula calls were replaced by per-node time preference (Phase 7). The market/position separation makes future mechanism changes (e.g. CPMM, order books) clean.
5. **Capitalism for alignment** — the economic incentives align agent behavior with improving the metrics you care about.
6. **Static definitions** — formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely — this is what agents bet on.
7. **Metrics as commitments, tasks as hypotheses** — a metric expresses what you are already certain affects your utility, at the level of abstraction you are certain about. If you are unsure whether a proxy truly maps to your goal, that uncertainty belongs in a task (with conditional markets to test it), not in the metric definition. The system optimizes exactly what you measure; defining the wrong metric is the user's responsibility. Prefer subjective, high-level definitions (e.g. *Happiness* as a self-reported score) over over-specified proxies (e.g. dopamine level). Proxies belong in tasks.
