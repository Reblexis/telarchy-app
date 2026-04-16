# Telarchy: Prediction Markets + Futarchy

## Name

*Telarchy* combines **telos** (Greek: ultimate purpose, end goal) and **-archy** (Greek: governance, rule). Governance by purpose; a system where everything is organized around and judged against a defined end goal.

**Relation to futarchy.** Futarchy (Robin Hanson, 2000) is the system this builds on: "vote on values, bet on beliefs." Its mechanism (conditional prediction markets that evaluate proposals against a welfare metric) is structurally identical to what telarchy uses. The one difference: futarchy requires a vote to define the welfare metric, because it was designed for groups that disagree on values. Telarchy removes that step. The owner defines their metrics directly. No voting, no aggregation. This makes the same mechanism usable by individuals, companies, and governments alike, wherever one party can define the goal unilaterally.

The name reflects this: futarchy foregrounds the *mechanism* (markets, the future decides); telarchy foregrounds the *goal* (the telos is given). The closest existing category is **decision markets**: conditional prediction markets that execute decisions rather than merely forecast. Telarchy is a decision market system with three additions not found elsewhere: metrics that can be flat or composed into hierarchies via formulas, an agent proposal economy where agents propose tasks and earn for approved ones, and a time preference system for forward-looking evaluation.

## Vision

The metrics tracker evolves from a passive measurement system into an active governance and forecasting engine. Agents participate in prediction markets on metric values, staking credits on their forecasts. The market produces a consensus forecast for every metric. Metrics with time preference enabled automatically incorporate these forward-looking consensus values via a decay-weighted temporal aggregation, and conditional markets enable the core decision loop.

The primary use case is company governance: founders and leadership teams define their KPIs, OKRs, or any quantified business objectives and let the market forecast and evaluate decisions against them. The system also supports personal use (health, career, life metrics) and any other domain where a single owner defines the goals. Metrics are standalone by default; each can independently have time preference and prediction markets. Users can later connect metrics with formulas if they want derived values, but there is no required structure.

**Agent** means any market participant, human or AI. A consultant, employee, or automated system can all register, propose tasks, and forecast. The economic logic applies equally to all.

The core thesis: **capitalism for alignment**. Alignment works through the task proposal cycle: an agent proposes an action with a price, conditional markets reveal its expected impact on metrics, and the owner approves or declines based on the per-metric forecast deltas. Agents whose forecasts are consistently accurate accumulate credits; agents whose forecasts are inaccurate lose them. The market makes manipulation transparent and expensive. A bad proposal is rejected not by opinion but by the crowd's forecasts.

## Metrics vs Tasks

The distinction between metrics and tasks is foundational.

**Metrics** are definitional commitments. A metric declares that some quantity *certainly* matters in a known way. If you later find the metric was wrong (that you measured the wrong thing), that is a definition error, not a system failure, and the system cannot fix it for you. The practical implication: define metrics at the level of abstraction you are genuinely certain about, and keep them as subjective as necessary. A self-reported *Happiness* score is often a better leaf metric than *Dopamine level*, because the link between dopamine and subjective happiness is uncertain.

> **Example.** Suppose you define Happiness as dopamine level, then start taking drugs. Your dopamine metric rises; you are still unhappy. The system has done nothing wrong; it optimized exactly what you asked. The error was in the definition. The correct approach: keep *Happiness* as the metric (self-reported), and create a task (*"Will increasing dopamine improve my subjective happiness?"*) evaluated via conditional prediction markets before committing.

**Tasks** are hypothesis tests. Any time you are uncertain whether an action will improve a metric, that uncertainty belongs in a task, not in the metric definition. Conditional markets answer the question "what would metrics look like if this task were completed?" and the crowd's money resolves the uncertainty. This extends to metric structure itself: an agent can propose a task such as *"Create a new metric X and evaluate its relationship to our goals"*, letting the market judge whether adding that measurement will produce useful signal before the admin commits to a structural change.

## Multi-workspace and domain metrics

Telarchy workspaces are composable. A common pattern: one personal workspace defining personal goals, and one or more domain workspaces (a startup, a project, a team) with their own metrics.

The connection between startup metrics and personal goals is often uncertain. How much does the startup's user count correspond to personal wealth? To social capital? These are empirical questions, not definitional ones, and they should not be hardwired into formulas. Instead:

- Treat the startup workspace as an information source. Agents observing both workspaces can use startup metrics as signal when proposing tasks and placing predictions in the personal workspace.
- Use tasks to test the connection. A task such as *"Will growing MAU by 20% improve my personal metrics?"* lets conditional markets evaluate the hypothesis before you commit resources.

This keeps the two workspaces decoupled at the definition level while still allowing agents to reason across them.

**Why maintain a separate domain workspace at all?**

1. **Agent information** - domain metrics (revenue, retention, velocity) give agents richer signal to reason about how to improve personal goals, without being hardcoded as direct formula inputs.
2. **Privacy** - the personal workspace may contain sensitive self-assessments. The startup workspace can be shared with employees, investors, or the public without exposing personal data.
3. **Multi-stakeholder** - multiple shareholders can co-own a startup workspace and independently evaluate its impact on their respective personal utilities. The exact coordination mechanism for this is an open design question.

Workspace settings include the display name and, for the workspace owner only, optional auto-funding of new non-task markets from that owner's agent balance (configured in workspace settings). The browser client always talks to the deployment API (`VITE_API_URL` / hosted URL). Self-hosting remains a deploy-time concern, not a per-workspace redirect.

## Current State

### Onboarding templates (Implemented)

`POST /api/workspaces` accepts an optional `template` field (`startup`, `personal`, or `blank`) plus `templateParams`. Non-blank templates provision a small, opinionated set of leaf metrics with time preference enabled, each with a `marketRangeMax` matched to the metric's realistic bounds and sibling TP half-lives chosen to reflect each metric's timescale. Templates encode the `metric-design` guide principles directly (outcomes not activities, subjective self-reports over speculative proxies). Users edit freely after creation. Template definitions live in `functions/src/lib/templates.ts`; the `/create-workspace` UI picks a template before asking for a name.

### Phase 1: Participant Economy (Implemented)

Participants sign up either through browser accounts or direct agent-key registration and then participate in a real-stakes economy.

- **Capabilities**: authorization is a flat set of three capabilities, `read` (view metrics/markets/tasks/vaults), `trade` (place trades, propose tasks, send task messages), and `manage` (admin operations: create/edit metrics, resolve markets, approve tasks, manage groups and members). A caller's effective capabilities are the union of the `capabilities` arrays on every permission group they belong to in the active workspace. The master API key, the platform admin flag (`platformAdmin` in the DB, bootstrapped from `ADMIN_EMAILS`), and the workspace creator/owner short-circuit to all three capabilities. There are no fixed role enums at the auth layer; legacy labels like `admin`, `agent`, `member` are derived on the fly for UI display and are not authoritative.
- **Authentication**: three paths checked in order: master API key (`X-API-Key` header), BetterAuth browser-account session (cookie, resolved via `auth.api.getSession()`), per-agent API key (`X-Agent-Key`, SHA-256 hashed). Google and GitHub OAuth are supported when `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` env vars are set. Browser accounts attach directly to a participant row in `agents` via `authUserId`. CORS and BetterAuth `trustedOrigins` come only from `ALLOWED_ORIGIN` / `TRUSTED_ORIGINS` (see `functions/src/lib/origins.ts`); `BETTER_AUTH_URL` is the public browser origin for OAuth redirects; optional `AUTH_COOKIE_DOMAIN` (e.g. `.example.com`) aligns cookies when apex and www both serve the app.
- **Identity symmetry**: human users and AI users are the same class of participant with different signup methods. A human-user login resolves to the same participant identity used by the corresponding agent-key session, so trading, task, and workspace capabilities stay aligned.
- **Balance tracking**: `balance`, `earnedBetting`, `earnedTasks`, `spentBetting`, `spentTokens` - separate counters for full auditability.
- **Credit economy**: On the managed instance (telarchy.com), credits are play-money with no cash value; admins distribute them via `POST /agents/:id/credit`. On self-hosted instances with USDC settlement enabled, every credit is backed 1:1 by USDC held in the treasury, created only via `POST /agents/:id/deposit` (USDC -> credits, requires on-chain tx hash verification).
- **Global balance**: An agent's balance row in `agents` table is not scoped to any workspace. Each agent has exactly one account with one credit balance usable across the system. **Balances are stored as integer nanocredits** (1 credit = 1,000,000,000 units) to eliminate IEEE 754 float drift. All reads go through `fromUnits()`, all writes use `toUnits()` before any SQL increment.
- **Admin UI**: agents page with admin badge (rendered when a participant has the `manage` capability), credit distribution, PnL display. Administrative access is granted by adding a participant to the Admin system group (or any group whose capabilities include `manage`), not via a direct role dropdown.

### Phase 2: Prediction Layer (Implemented)

Agents forecast metric values, staking credits on their predictions.

- **Markets**: created by admin or auto-created from time-preference curves. Markets are also refreshed daily (00:10 UTC cron).
- **Date granularity**: markets support multiple target date formats: `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC).
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Formula Composition (Implemented)

Metric formulas use `{MetricName}` references plus standard math operators and helper functions such as `sqrt()`, `abs()`, `min()`, `max()`, and `pow()`. Forward-looking behavior is handled by the time-preference system, not by special formula syntax.

### Phase 4: Tasks and Conditional Decision Markets (Implemented)

Agents propose tasks with a price (credits they receive if approved). The system evaluates each proposal by running the existing prediction markets conditionally against it.

**How it works**:
1. Agent calls `POST /api/tasks` with `{ title, description, price }`.
2. When an agent or admin fetches markets with `?taskId=<id>`, the system auto-creates **conditional markets** (clones of all currently active leaf-metric markets, starting with zero positions, tagged with the `taskId`).
3. Agents forecast on conditional markets to signal expected impact: "what will metric X be if this task is completed?"
4. Admin views the task detail, which shows: conditional consensus vs baseline consensus for every market, revealing per-metric impact predictions.
5. **Approve** - proposing agent receives `price` credits (tracked in `earnedTasks`); conditional markets remain and resolve normally.
6. **Decline** - conditional markets are voided; all participant stakes are fully refunded.

A per-task message thread (`tasks/{taskId}/messages`) enables agent-admin negotiation before a decision is made.

Admin can also refresh conditional markets at any time to pick up newly created base markets.

### Phase 1b: Permission Groups (Implemented)

Per-workspace access control via a workspace-scoped `permissionGroups` table. Group names are labels ("nametags"); authorization is driven entirely by each group's `capabilities` array (a subset of `['read','trade','manage']`). A caller's effective capabilities are the union across every group they belong to.

- **Types**: `public`, `admin`, `trader`, `custom`. Type is purely a seeding hint; once created, every group's capabilities can be edited freely. System groups (`Public`, `Admin`, `Trader`) are bootstrapped on workspace creation with capability presets `['read']`, `['read','trade','manage']`, and `['read','trade']` respectively, and cannot be renamed or deleted (their capabilities can still be edited).
- **Unified access model**: Groups use canonical `memberIds[]` participant membership. Every route guard calls `requireCapability('read' | 'trade' | 'manage')` against the caller's unioned capability set; there are no hardcoded role checks. The master API key and the workspace creator/owner are granted all capabilities automatically.
- **Per-metric, per-vault, and per-connector permissions**: groups additionally carry a `permissions` map (`metricId -> { read, trade }`), a `vaultPermissions` map (`vaultId -> { read }`), and a `connectorPermissions` map (`connectorId -> { read }`) for resource-level access. These gate specific metrics/vaults/connectors for members of groups that include the corresponding workspace-level capability.
- **Workspace joining**: any authenticated participant can join any workspace via `POST /workspaces/:id/join`, which adds them to the Public group (read-only by default). Admins then add the participant to the Trader or Admin group (or any custom group) to expand capabilities.
- **API**: `GET /groups` (requires `read`), `POST /groups`, `PUT /groups/:id`, `DELETE /groups/:id` (all require `manage`). POST/PUT bodies accept a `capabilities: string[]` field.

### Vaults (Implemented)

Workspace-scoped free-text information store with permission-group-based access control. Admins create vaults to hold credentials, API keys, context docs, or any information that should be selectively shared with workspace participants. Permission groups control who can read which vaults via a `vaultPermissions` map (`vaultId -> { read: boolean }`). Any participant with the `manage` capability has implicit read access to all vaults.

### Connectors (Implemented)

Workspace-scoped live bridges to external data sources with permission-group-based access control. Currently supports GitHub (read-only repo access via OAuth). Admins connect a repo through the GitHub OAuth flow; participants with connector read access can browse the directory tree and read file contents via the API. Permission groups control access via a `connectorPermissions` map (`connectorId -> { read: boolean }`). Any participant with the `manage` capability has implicit read access to all connectors. Separate from vaults, which store static text/secrets.

### Phase 5: Binary AMM (Implemented)

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule). Agents predict **higher** or **lower**, with no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0–1000) and stores `shares: [lowerShares, higherShares]`.
- Agents predict **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- Agents can also **sell** existing positions back to the AMM at current prices.
- **Consensus** = `rangeMin + p(higher) * (rangeMax - rangeMin)`, fed back into metric formulas.
- **At resolution**, payouts are **proportional**: if actual value V falls at fraction `p = (V - rangeMin) / (rangeMax - rangeMin)`, higher shares pay `p` credits each, lower shares pay `1 - p` credits each.

**LMSR mechanics**:
```
C(q) = b * ln(exp(q_lower / b) + exp(q_higher / b))
tradeCost = C(q_after) - C(q_before)
p(higher) = 1 / (1 + exp(-(q_higher - q_lower) / b))
```
`b` (liquidity parameter; admin injects liquidity to enable trading) controls price sensitivity.

**LP accounting**: liquidity providers are charged only `poolIncrease` (what actually enters the pool), not the full liquidity parameter, which prevents ~30% overcharge on fresh markets. At resolution and void, any pool leftover is distributed back to LPs proportionally based on `poolContribution` recorded in `liquidityEvents`.

**Key details**:
- `Market` stores: `rangeMin`, `rangeMax`, `shares: [lower, higher]`, `liquidity`
- `positions` track direction (`higher`/`lower`) + shares per agent per market
- `POST /predictions/trade` - two modes: `{direction, amount}` or `{value, amount}` (auto-picks direction based on which side the value falls)
- **UI**: probability slider per market, Higher/Lower buttons

### Phase 7: Time Preference System (Implemented)

Replaces `consensus()` formula calls with a per-node **time preference** property that automatically handles forward-looking evaluation and market creation.

**Core model**:
- `timePreference: { enabled: boolean, halfLife: number }` - **enabled by default** on new metrics (half-life 1 year). Without TP, a metric has no markets and cannot be tracked over time.
- When enabled, the node's value is a decay-weighted blend of: the current value (at t=0) plus market consensus values at 10 sampled future time points.
- **Formulas stay simple**: only `{MetricName}` references and math. No `consensus()` calls.
- **Sampling**: 10 quantile-midpoint samples from an exponential distribution with the given `halfLife` (in years). Each sample covers equal probability mass; weights are uniform. The median sample falls at `t = halfLife`.
- **Date granularity** of sampled time points adapts to distance: `YYYY-MM-DD` (< 1 week), `YYYY-Www` (< 1 month), `YYYY-MM` (< 1 year), `YYYY` (≥ 1 year).
- **Markets** are created only for leaf nodes (metrics with no formula), at the time points sampled by their ancestor's time-preference curve.

**Computation**:
```
value = sum(weight(t_i) * formula_eval_at_t_i) / sum(weight(t_i))
```
Non-leaf intermediate nodes in the subtree are evaluated deterministically from their formulas given predicted leaf values; no markets needed for them.

**Tree zone model**: when TP is on a computed metric, it divides the subtree into two zones:
- **Above the TP node**: purely compositional. These metrics combine TP-blended children via formulas and are forward-looking as a result. They don't interact with markets directly.
- **Below the TP node** (leaf metrics and intermediate computed metrics in the subtree): represent the *current state only*. Leaves are updated directly; computed nodes below TP evaluate deterministically from current values. The TP node above them handles all temporal expansion.

Any metric, leaf or computed, can have time preference enabled. A leaf with TP creates markets for itself and blends its current value with market consensus at future dates. A computed metric with TP creates markets for all its leaf descendants.

**Constraints**:
- **One time-preferenced node per path**: on any path through the metric graph, at most one node may have time preference enabled. Parent TP overrides children; enabling TP on a parent automatically removes TP from its descendants (with a warning). Enabling TP on a child when an ancestor already has TP is rejected.
- **Descendants describe current state**: all metrics below a time-preferenced node must represent the present; the TP node handles the forward-looking aspect for its entire subtree.

**Market lifecycle**:
- **Invariant**: a market may only exist while its metric's **definition** (name, description, formula, `marketRangeMax`) is unchanged from when the market was created. The set of valid statuses is:
  - **open**: trading allowed, will resolve on `targetDate`.
  - **closed** (`active: false`, not resolved, not voided): trading halted because the metric no longer references that `(metricId, targetDate)` pair (e.g. half-life change, or calendar time progressed past the sampled dates). The definition is still valid, so the market resolves normally on `targetDate` against the metric's live value. Existing positions are retained.
  - **resolved**: `targetDate` has passed, positions paid out against the metric's actual value.
  - **voided**: market was cancelled and all positions refunded at cost. This is the only correct outcome whenever the metric's definition would change or disappear out from under a market.
- **Closure happens when and only when** the trading window expires with the definition unchanged. Any edit that changes the definition (name, description, formula, `marketRangeMax`) voids all open markets for that metric and respawns fresh ones under the new definition. Deleting a metric voids all its open markets (refunds at cost); descendant markets under a deleted non-leaf TP ancestor keep their own unchanged definitions and close naturally.
- The daily cron (00:10 UTC) and "Refresh Markets" button compute the desired `(leafId, targetDate)` set and create missing markets. Markets falling out of the desired set are set `active: false` (closed).
- A distributed refresh lock prevents duplicate creation from concurrent refresh calls.

**Examples**:
```
# Flat: TP directly on leaves
Revenue (leaf, TP: half-life=1y) ← markets for Revenue itself
NPS (leaf, TP: half-life=0.5y) ← markets for NPS itself

# Hierarchical: TP on computed nodes
Overall (formula: {Health} + {Career})
├── Health (TP: half-life=2y, formula: {Sleep} + {Exercise})
│   ├── Sleep (leaf) ← markets at sampled time points
│   └── Exercise (leaf) ← markets at sampled time points
└── Career (TP: half-life=5y, formula: {Income} + {Satisfaction})
    ├── Income (leaf) ← markets at sampled time points
    └── Satisfaction (leaf) ← markets at sampled time points
```

### Phase 8: USDC Settlement on Base (Implemented, opt-in)

On self-hosted instances with `USDC_SETTLEMENT_ENABLED=true`, credits are backed by real USDC. A treasury wallet on the Base L2 network holds the USDC reserve. Agents register a Base wallet address and can withdraw their credit balance as on-chain USDC at any time. On the managed instance (telarchy.com), USDC settlement is disabled and credits are play-money with no cash value.

**Settlement model**:
- Internal credit transfers (forecasting, task payouts, gifting) remain purely off-chain, with no gas fees.
- On-chain settlement only happens at withdrawal time, keeping fees negligible (~$0.001/tx on Base).
- Conversion rate: `creditValueUsd` from the `systemConfig` table (key: `economy`) determines how many USDC a credit is worth.

**API**:
- `PUT /api/agents/:id/wallet` - register or update a Base wallet address (self or admin).
- `POST /api/agents/:id/withdraw` - body `{ amount }`: deducts `amount` credits, sends `amount * creditValueUsd` USDC on-chain. Atomically re-credits on tx failure.
- `GET /api/agents/treasury` - admin only: returns treasury address and current USDC balance.

**Audit trail**: every withdrawal is recorded in the `withdrawals` table with `{ agentId, credits, usdcAmount, toAddress, txHash, createdAt }`.

**Credit purchase (open to anyone)**:
- Treasury receive address: `GET /api/agents/deposit-address` (no auth). Admins can also use `GET /api/agents/treasury` for the address plus live balances.
- Send USDC on Base to that address, then call `POST /api/agents/:id/deposit` with the tx hash.
- Backend verifies the transfer on-chain (reads the Transfer event, checks recipient = treasury).
- Credits issued: `floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100)))`.
- The fee surplus stays in the treasury. The system is self-sustaining: total USDC held ≥ credits outstanding × creditValueUsd at all times.
- Each tx hash is stored in the `deposits` table and rejected if reused (double-spend prevention).

**Web UI**: signed-in users get **Top up with USDC** from Account (balance area and sidebar); deposit panels render **`GET /api/guides/credits`** for prose and **`GET /api/agents/deposit-address`** for live contract/treasury values (same as any API client), plus the existing **`POST /api/agents/me/deposit`** form.

**Economy parameters** (stored in the `systemConfig` table, key: `economy`):
- `creditValueUsd` - USD value of 1 credit (also used for withdrawal conversion).
- `buyFeePercent` - fee percentage added on top when buying credits (default 0). E.g. 5 means 105 USDC -> 100 credits.

**Setup**: set `TREASURY_PRIVATE_KEY` (hex, `0x`-prefixed) and `USDC_SETTLEMENT_ENABLED=true` in server environment configuration. Without both, deposit/withdraw/wallet/treasury endpoints return 503. The managed instance runs with settlement disabled; self-hosted operators who enable it are responsible for their own regulatory compliance (see ToS section 6).

### Agent Economy Parameters (Implemented)

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the system economy configuration. Admin sets this; agents use it to understand the real-money value of their balance.

**Credit model**: On the managed instance, credits are play-money distributed by admins. On USDC-enabled instances, 1 credit = `creditValueUsd` USD; total credits in circulation equal total USDC in the treasury divided by `creditValueUsd`. Internal flows (forecast wins/losses, task payouts, agent-to-agent transfers) are purely redistributive. Credits go down from inaccurate forecasts (automatic through AMM) and voluntary agent purchases. Agents can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

### Hooks (Implemented)

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes agents when subscribed events occur. Agent config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) - agent is woken on any event of that type, or
  - an **object** `{ type, metricNames?, metricIds? }` - filter by metric name/id.

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
│   Admin UI   │────▶│  Express API     │────▶│   PostgreSQL     │
│  (React)     │     │  (Node.js)       │     │  (Drizzle ORM)   │
└─────────────┘     └──────────────────┘     │                  │
                           ▲                  │  agents          │
┌─────────────┐            │                  │  agentApiKeys    │
│  AI Agents   │───────────┘                  │  markets (AMM)   │
│  (OpenClaw)  │   X-Agent-Key auth           │  positions       │
└─────────────┘                               │  trades          │
                                              │  metrics         │
                                              │  metricLogs      │
                                              │  updates         │
                                              │  tasks           │
                                              │  workspaces      │
                                              │  permGroups      │
                                              └──────────────────┘

Managed (telarchy.com): Cloud Run + managed PostgreSQL (same code, different env)
Self-hosted: docker compose up (includes postgres service) or any Linux host + postgres
```

## Navigation

The app uses a persistent left sidebar (`Sidebar.tsx` + `AppLayout.tsx`) for all authenticated pages. The sidebar handles workspace switching (all workspaces listed, click to switch), workspace-scoped nav (Metrics, Markets, Tasks, Agents), platform nav (Marketplace, Account, Guides), and logout. The horizontal header (`Header.tsx`) is kept only for the API-key portal. `/account` shows the signed-in participant identity and balance, and links to the API-key portal for direct API access when needed.

`/marketplace` is both a discovery surface and a trading surface: anonymous visitors can browse public markets, while signed-in users can see the active markets from workspaces they belong to and trade on them directly as their authenticated participant identity. Marketplace lists are ordered by actual resolution date (not by liquidity), and each card preserves the original granularity label (`month`, `week`, etc.) while also showing the exact UTC resolution timestamp.

`/guides` is a publicly accessible in-app reference covering metric structure, formula syntax, time preference, markets, and the task decision loop. No auth required.

The selected workspace now owns its workspace-scoped links directly in the sidebar. Metrics, Markets, Tasks, Agents, and workspace Settings render as a collapsible nested subsection under the active workspace rather than as a separate top-level "Workspace" section, which keeps workspace context and page context aligned.

## Design Principles

1. **Simplicity first** - each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** - metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** - all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** - the market/position separation and the time-preference architecture keep future mechanism changes (e.g. CPMM, order books, new curve families) clean.
5. **Capitalism for alignment** - the economic incentives align agent behavior with improving the metrics you care about.
6. **Static definitions** - formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely; this is what agents forecast.
7. **Metrics as commitments, tasks as hypotheses** - a metric expresses what you are already certain affects your utility, at the level of abstraction you are certain about. If you are unsure whether a proxy truly maps to your goal, that uncertainty belongs in a task (with conditional markets to test it), not in the metric definition. The system optimizes exactly what you measure; defining the wrong metric is the user's responsibility. Prefer subjective, high-level definitions (e.g. *Happiness* as a self-reported score) over over-specified proxies (e.g. dopamine level). Proxies belong in tasks.

## Business Model

**Open core.** The full backend and frontend are MIT-licensed; anyone can run their own instance from the public Docker image (`ghcr.io/reblexis/metrics-tracker-server`). Self-hosting is free forever. This lowers the barrier to adoption and makes the platform trustworthy for privacy-sensitive users, since they can verify every line of code that touches their data.

**The moat is the agent network, not the software.** Agents accumulate trading history, calibration scores, and reputation over time. These are network effects that cannot be cloned from source code. The revenue model is built around access to this network:

- **Free managed tier** - workspaces hosted on the central platform, access to the shared agent pool; free to drive adoption and grow the network flywheel.
- **Agent network federation (paid)** - self-hosted instances that want to use the central agent pool pay a federation fee; without federation their agents are fully local and isolated. Federation pricing reflects API calls to the shared agent economy, not hosting costs.
- **Enterprise** - SLA, DPA, custom agent training pipelines, dedicated support; not competing on hosting price but on accountability and integration depth.
- **Transaction fees** - a percentage fee on trades (configurable via `buyFeePercent`), applied as a supplementary revenue stream.

Self-hosted workspaces that stay fully isolated remain free in perpetuity. The goal is not to lock users in but to make the managed network valuable enough that most users prefer it.

## Infrastructure

**Database**: PostgreSQL with Drizzle ORM (single schema, no Firestore dependency). Both managed and self-hosted deployments use the same stack. The Docker image bundles the frontend and backend, and a PostgreSQL service is provided via `docker-compose.yml`.

**Authentication**: BetterAuth replaces Firebase Auth. Email/password is always available; Google and GitHub OAuth are opt-in via environment variables. Sessions are cookie-based (works cross-origin with `credentials: 'include'`). There is no hostname baked into the server: set `ALLOWED_ORIGIN` (comma-separated or `*`), `BETTER_AUTH_URL`, and when needed `AUTH_COOKIE_DOMAIN` / `TRUSTED_ORIGINS` the same way on Docker, Firebase (via `functions/.env` loaded at deploy), or any host. Managed and self-hosted use the same Express app and env contract.

**Self-hosting**: `docker compose up` spins up a complete instance (backend + frontend + PostgreSQL) with no external dependencies. Run `npm run db:migrate` (in `functions/`) once after first boot to create the schema. Cron jobs must be triggered externally (see `.env.example`).

## Tests

The test suite lives alongside the code it exercises. Tests serve as executable documentation; they define expected behavior and catch regressions.

**Unit tests** (`functions/src/__tests__/`):
| File | What it covers |
|---|---|
| `amm.test.ts` | LMSR AMM math: cost, probability, consensus, trade cost, payouts |
| `metrics-engine.test.ts` | Formula evaluation, circular-dep detection, topo sort, recalculation, propagation |
| `date-utils.test.ts` | Date parsing, granularity detection, relative-to-absolute conversion, `endOfPeriod` |
| `validation.test.ts` | `validateAgentId`, `validateContent`, `validateTxHash` |

Run with `npm test` (in `functions/`) or `npm test` from the repo root.

**Integration tests** (`scripts/test-integration.ts`):

End-to-end test suite that hits the live API. Covers: health, workspaces, agents, admin credit, metrics (CRUD, formulas, circular deps), prediction markets (create, refresh, liquidity injection, market fields), trading (buy, sell, balance tracking, error cases), tasks (propose, approve, decline), permission groups, workspace isolation (cross-tenant data separation), events, and auth.

Run against a local instance:
```bash
BASE_URL=http://localhost:8080 API_KEY=<master-key> node scripts/test-integration.ts
```
Or via npm: `npm run test:integration` (set env vars first).

The integration tests create their own workspace and data, and clean up after themselves. They are designed to pass on a fresh instance and to be extended by adding new `test()` calls in the appropriate `suite()` block.
