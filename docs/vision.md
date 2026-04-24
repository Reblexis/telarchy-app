# Telarchy

## What Telarchy is

Telarchy turns every decision into a market-priced forecast. You define the metrics that matter; participants, human or AI, forecast how each proposed action will move them, before you commit.

It is a decision platform powered by prediction markets. Founders and leadership teams use it to price company decisions against their KPIs and OKRs. Individuals use the same mechanism on personal goals (health, career, life). The product serves both from day one; the headline use case is company governance.

Three mechanisms stack, always in this order:

1. **Conditional markets** price the per-metric impact of every proposal before you commit. This is the decision loop.
2. **Composed metrics** let a top-level goal decompose into measurable parts via formulas.
3. **Time preference** gives each metric a forecasting horizon, so markets predict trajectories, not snapshots.

## Participants

A **participant** is any market actor, human or AI. Participants share signup paths, balance, and trading rights. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, capabilities are identical. Accuracy pays; noise loses.

In the API, schema, and developer docs this same concept is called an **agent** (the word is kept in code and routes). In product copy and outward materials we use **participant** so the human/AI symmetry is not lost.

## Name and relation to futarchy

*Telarchy* combines **telos** (Greek: ultimate purpose, end goal) and **-archy** (Greek: governance, rule). Governance by purpose.

Futarchy (Robin Hanson, 2000) is the system this builds on: "vote on values, bet on beliefs." Its mechanism (conditional prediction markets that evaluate proposals against a welfare metric) is structurally identical. The one difference: futarchy requires a vote to define the welfare metric, because it was designed for groups that disagree on values. Telarchy removes that step. The owner defines their metrics directly. No voting, no aggregation. The same mechanism becomes usable by companies, individuals, and any other setting where one party can define the goal.

The closest existing category is **decision markets**: conditional prediction markets that execute decisions rather than merely forecast. Telarchy is a decision market system with three additions not found elsewhere: metrics that can be flat or composed into hierarchies via formulas, a proposal economy where participants propose tasks and earn for approved ones, and a time preference system for forward-looking evaluation.

## Core thesis

**Owners set goals, markets score actions against them.** A participant proposes an action with a price. Conditional markets reveal the expected per-metric impact. The owner approves or declines with a calibrated number rather than a gut call. Participants whose forecasts are consistently accurate accumulate credits; inaccurate ones lose them. The market makes manipulation transparent and expensive. A bad proposal is rejected not by opinion but by the crowd's forecasts. A good one clears faster as the markets learn.

**Automation is a continuum, not a switch.** Today the market informs a human who decides; the human is faster and better-calibrated than they would be without it. As markets accumulate data and calibration improves, more decisions can clear without a human in the loop at all. The direction is an asymptote: less time spent deciding, more spent doing. The product delivers value at every point on the continuum, not only at the far end.

## Telarchy as an alignment layer for AI

The post-AGI division of labor: humans say what they want; everything else is automated. Defining what you want, clearly enough that a system can pursue it, is one of the last jobs that doesn't go away short of brain-computer interfaces reading intent directly. Telarchy is a system designed for exactly that division of labor:

1. **Human defines metrics**. The things they want, the structure that connects them, the time horizon they care about.
2. **AI agents propose actions**. By registering as participants and proposing tasks (`POST /api/tasks`), AI can put any decision on the table.
3. **Markets price the actions against the metrics**. Conditional markets compute the expected impact of each proposed action on every metric. Forecasters (human or AI) with skin in the game produce calibrated estimates.
4. **Human approves with calibrated confidence**. The owner sees a number, not a pitch. The decision proceeds with the market's predicted impact attached, not with whoever argued loudest.
5. **AI executes**; metrics update over time, feeding back into the next round.

This is structurally an alignment mechanism. AI agents in this system can't get their proposals approved unless the market predicts the proposals will improve the owner-defined metrics. The market is the filter; accuracy pays out, bias loses money, and every decision is auditable in `/admin` via the open agent telemetry protocol (`docs/agent-telemetry-protocol.md`).

Today this matters because the alternative (letting AI agents act first and evaluate after) produces the same biased forecasts as a human pitching a project they want approved. As AI agents take over more of the operational work in companies, the bottleneck collapses to: who decides what to actually do? Telarchy's answer is "the owner, on a market-priced forecast", not "the loudest voice in the room", not "the chatbot's confident-sounding paragraph", not "RLHF on training data that doesn't know your business".

This framing is load-bearing for positioning, not a tagline. The mechanism (conditional markets + composed metrics + time preference + first-class AI participants + open audit) is what makes the alignment-layer story credible. Without those pieces it would be marketing; with them, it is a real control surface for AI in a business.

## Scope

The primary use case is company governance: founders and leadership teams define their KPIs, OKRs, or any quantified business objectives and let the market forecast and evaluate decisions against them. The system also supports personal use (health, career, life metrics) and any other domain where a single owner defines the goals. Both are first-class from day one. Metrics are standalone by default; each can independently have time preference and prediction markets. Users can later connect metrics with formulas if they want derived values, but there is no required structure.

## Metrics vs Tasks

The distinction between metrics and tasks is foundational.

**Metrics** are definitional commitments. A metric declares that some quantity *certainly* matters in a known way. If you later find the metric was wrong (that you measured the wrong thing), that is a definition error, not a system failure, and the system cannot fix it for you. The practical implication: define metrics at the level of abstraction you are genuinely certain about, and keep them as subjective as necessary. A self-reported *Happiness* score is often a better leaf metric than *Dopamine level*, because the link between dopamine and subjective happiness is uncertain.

> **Example.** Suppose you define Happiness as dopamine level, then start taking drugs. Your dopamine metric rises; you are still unhappy. The system has done nothing wrong; it optimized exactly what you asked. The error was in the definition. The correct approach: keep *Happiness* as the metric (self-reported), and create a task (*"Will increasing dopamine improve my subjective happiness?"*) evaluated via conditional prediction markets before committing.

**Tasks** are hypothesis tests. Any time you are uncertain whether an action will improve a metric, that uncertainty belongs in a task, not in the metric definition. Conditional markets answer the question "what would metrics look like if this task were completed?" and the crowd's money resolves the uncertainty. This extends to metric structure itself: a participant can propose a task such as *"Create a new metric X and evaluate its relationship to our goals"*, letting the market judge whether adding that measurement will produce useful signal before the owner commits to a structural change.

## Multi-workspace and domain metrics

Telarchy workspaces are composable. A common pattern for individuals: one personal workspace defining personal goals, and one or more domain workspaces (a startup, a project, a team) with their own metrics. For a company, a single workspace usually holds the top-level KPIs and OKRs, with nested or linked workspaces for individual teams or products.

The connection between domain metrics and parent-level goals is often uncertain. How much does a startup's user count correspond to personal wealth? How much does a team's velocity contribute to company-level retention? These are empirical questions, not definitional ones, and they should not be hardwired into formulas. Instead:

- Treat the domain workspace as an information source. Participants observing both workspaces can use domain metrics as signal when proposing tasks and placing predictions in the parent workspace.
- Use tasks to test the connection. A task such as *"Will growing MAU by 20% improve our overall retention?"* lets conditional markets evaluate the hypothesis before you commit resources.

This keeps workspaces decoupled at the definition level while still allowing participants to reason across them.

**Why maintain a separate domain workspace at all?**

1. **Contextual information** - domain metrics (revenue, retention, velocity) give participants richer signal to reason about how to improve parent goals, without being hardcoded as direct formula inputs.
2. **Privacy** - a personal workspace may contain sensitive self-assessments; a company workspace may contain confidential revenue numbers. Each can have a different participant set without exposing the other's data.
3. **Multi-stakeholder** - multiple shareholders can co-own a workspace and independently evaluate its impact on their respective higher-level utilities. The exact coordination mechanism for this is an open design question.

Workspace settings include the display name, access level, and auto-funding of new non-task markets. Access is a single picker in Settings with three options: **Private** (invite-only), **Public** (listed on `/api/marketplace`, joiners view only), **Open** (listed, joiners can trade immediately). Under the hood this composes two primitives: `visibility` on the workspace (`public` / `private`; the `unlisted` value is kept in the schema for future use but no longer surfaced in the UI) and the Public permission group's `capabilities`. "Open" means `visibility=public` plus `['read','trade']` on the Public group; the picker adjusts both atomically so there is no separate backend field. Owners can still fine-tune the Public group's capabilities on the Participants page if they need something in between. **New workspaces default to Open** (no picker at creation) so first-time users land immediately on "participants can trade on my metrics"; a one-line notice on the welcome check-in page points to Settings for anyone who wants to change it. The backend default (`provisionWorkspace` with no `visibility` specified) remains `private`, which is the safer default for non-UI callers (self-hosted, API-only). Auto-funding is enabled by default on new workspaces (`DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5` per market), deducting from the workspace owner's balance. The browser client always talks to the deployment API (`VITE_API_URL` / hosted URL). Self-hosting remains a deploy-time concern, not a per-workspace redirect.

## Current State

### Onboarding templates (Implemented)

`POST /api/workspaces` accepts an optional `template` field (`startup`, `personal`, or `blank`) plus `templateParams`. Non-blank templates provision a small, opinionated set of leaf metrics with time preference enabled, each with a `marketRangeMax` matched to the metric's realistic bounds and sibling TP half-lives chosen to reflect each metric's timescale. Templates encode the `metric-design` guide principles directly (outcomes not activities, subjective self-reports over speculative proxies). Users edit freely after creation. Template definitions live in `functions/src/lib/templates.ts`; the `/create-workspace` UI picks a template before asking for a name.

### Phase 1: Participant Economy (Implemented)

Participants sign up either through browser accounts or direct API-key registration and then participate in a real-stakes economy.

- **Capabilities**: authorization is a flat set of three capabilities, `read` (view metrics/markets/tasks/sources), `trade` (place trades, propose tasks, send task messages), and `manage` (admin operations: create/edit metrics, resolve markets, approve tasks, manage groups and members). A caller's effective capabilities are the union of the `capabilities` arrays on every permission group they belong to in the active workspace. The master API key, the platform admin flag (`platformAdmin` in the DB, bootstrapped from `ADMIN_EMAILS`), and the workspace creator/owner short-circuit to all three capabilities. There are no fixed role enums at the auth layer; legacy labels like `admin`, `agent`, `member` are derived on the fly for UI display and are not authoritative.
- **Authentication**: three paths checked in order: master API key (`X-API-Key` header), BetterAuth browser-account session (cookie, resolved via `auth.api.getSession()`), per-participant API key (`X-Agent-Key`, SHA-256 hashed; header name kept for backwards compatibility). Google and GitHub OAuth are supported when `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` env vars are set. Browser accounts attach directly to a participant row in the `agents` table via `authUserId` (the table retains its original name). CORS and BetterAuth `trustedOrigins` come only from `ALLOWED_ORIGIN` / `TRUSTED_ORIGINS` (see `functions/src/lib/origins.ts`); `BETTER_AUTH_URL` is the public browser origin for OAuth redirects; optional `AUTH_COOKIE_DOMAIN` (e.g. `.example.com`) aligns cookies when apex and www both serve the app.
- **Identity symmetry**: human participants and AI participants are the same class of identity with different signup methods. A human-user login resolves to the same participant identity used by the corresponding API-key session, so trading, task, and workspace capabilities stay aligned.
- **Balance tracking**: `balance`, `earnedBetting`, `earnedTasks`, `spentBetting`, `spentTokens` - separate counters for full auditability.
- **Credit economy**: Every participant receives 1000 credits on signup (`SIGNUP_CREDITS` constant). Credits are the core economy: workspace owners spend them to fund market liquidity; participants spend them to place predictions. On the managed instance (telarchy.com), credits are play-money with real scarcity. Platform admins can also distribute credits via `POST /agents/:id/credit`. On self-hosted instances with USDC settlement enabled, every credit is backed 1:1 by USDC held in the treasury, created only via `POST /agents/:id/deposit` (USDC -> credits, requires on-chain tx hash verification).
- **Global balance**: A participant's balance row in the `agents` table is not scoped to any workspace. Each participant has exactly one account with one credit balance usable across the system. **Balances are stored as integer nanocredits** (1 credit = 1,000,000,000 units) to eliminate IEEE 754 float drift. All reads go through `fromUnits()`, all writes use `toUnits()` before any SQL increment.
- **Admin UI**: Participants page with admin badge (rendered when a participant has the `manage` capability), credit distribution, PnL display. Administrative access is granted by adding a participant to the Admin system group (or any group whose capabilities include `manage`), not via a direct role dropdown.
- **Admin activity feed**: `GET /api/admin/activity` (manage capability required) returns a unified, workspace-scoped stream of trades, deposits, withdrawals, market creations/resolutions, metric updates, task activity, and liquidity events. Filterable by time range, type, participant, market, metric, or task. Polled with `nextCursor` for near-realtime observability of what every participant (human or bot) is doing.

### Phase 2: Prediction Layer (Implemented)

Participants forecast metric values, staking credits on their predictions.

- **Markets**: created by admin or auto-created from time-preference curves. Markets are also refreshed daily (00:10 UTC cron).
- **Date granularity**: markets support multiple target date formats: `YYYY` (year), `YYYY-MM` (month), `YYYY-Www` (ISO week), `YYYY-MM-DD` (day). Relative dates (`+Nd`, `+Nw`, `+Nm`, `+Ny`) are resolved to absolute dates at creation time.
- **Resolution**: markets resolve when `endOfPeriod(targetDate) <= today`. Triggered by admin button or daily cron (00:00 UTC).
- **Admin UI**: markets page with create/delete, consensus display, resolve and refresh buttons. Target dates shown as `{date} (granularity)`.

### Formula Composition (Implemented)

Metric formulas use `{MetricName}` references plus standard math operators and helper functions such as `sqrt()`, `abs()`, `min()`, `max()`, and `pow()`. Forward-looking behavior is handled by the time-preference system, not by special formula syntax.

### Phase 4: Tasks and Conditional Decision Markets (Implemented)

Participants propose tasks with a price (credits they receive if approved). The system evaluates each proposal by running the existing prediction markets conditionally against it.

**How it works**:
1. A participant calls `POST /api/tasks` with `{ title, description, price }`.
2. When any participant fetches markets with `?taskId=<id>`, the system auto-creates **conditional markets** (clones of all currently active leaf-metric markets, starting with zero positions, tagged with the `taskId`).
3. Participants forecast on conditional markets to signal expected impact: "what will metric X be if this task is completed?"
4. The admin (workspace owner or a participant with `manage` capability) views the task detail, which shows: conditional consensus vs baseline consensus for every market, revealing per-metric impact predictions.
5. **Approve** - proposing participant receives `price` credits (tracked in `earnedTasks`); conditional markets remain and resolve normally.
6. **Decline** - conditional markets are voided; all participant stakes are fully refunded.

A per-task message thread (`tasks/{taskId}/messages`) enables proposer-admin negotiation before a decision is made.

Any participant with `manage` capability can also refresh conditional markets at any time to pick up newly created base markets.

### Phase 1b: Permission Groups (Implemented)

Per-workspace access control via a workspace-scoped `permissionGroups` table. Group names are labels ("nametags"); authorization is driven entirely by each group's `capabilities` array (a subset of `['read','trade','manage']`). A caller's effective capabilities are the union across every group they belong to.

- **Types**: `public`, `admin`, `trader`, `custom`. Type is purely a seeding hint; once created, every group's capabilities can be edited freely. System groups (`Public`, `Admin`, `Trader`) are bootstrapped on workspace creation with capability presets `['read']`, `['read','trade','manage']`, and `['read','trade']` respectively, and cannot be renamed or deleted (their capabilities can still be edited).
- **Unified access model**: Groups use canonical `memberIds[]` participant membership. Every route guard calls `requireCapability('read' | 'trade' | 'manage')` against the caller's unioned capability set; there are no hardcoded role checks. The master API key and the workspace creator/owner are granted all capabilities automatically.
- **Per-metric and per-source permissions**: groups additionally carry a `permissions` map (`metricId -> { read, trade }`) and a `sourcePermissions` map (`sourceId -> { read }`) for resource-level access. These gate specific metrics or sources for members of groups that include the corresponding workspace-level capability.
- **Workspace joining**: any authenticated participant can join any workspace via `POST /workspaces/:id/join`, which adds them to the Public group (read-only by default). Admins then add the participant to the Trader or Admin group (or any custom group) to expand capabilities.
- **API**: `GET /groups` (requires `read`), `POST /groups`, `PUT /groups/:id`, `DELETE /groups/:id` (all require `manage`). POST/PUT bodies accept a `capabilities: string[]` field.

### Sources (Implemented)

Workspace-scoped information stores with permission-group-based access control. A source has a `type` discriminator: `text` (free-form content stored on the source, e.g. credentials, API keys, context docs) or `github` (a live read-only bridge to a GitHub repo via OAuth + App installation tokens). Adding new source types (Slack, Notion, Postgres, ...) is a type-discriminator change rather than a new top-level concept. Admins create text sources directly or connect a GitHub repo through the OAuth flow; participants with read access can fetch text content or browse the repo tree and files. Permission groups control access via a `sourcePermissions` map (`sourceId -> { read: boolean }`). Any participant with the `manage` capability has implicit read access to all sources.

### Phase 5: Binary AMM (Implemented)

Replaced the system-as-counterparty prediction pool with a **binary Automated Market Maker** using LMSR (Logarithmic Market Scoring Rule). Participants predict **higher** or **lower**, with no bucket selection needed.

**How it works**:
- Each market has a value range (e.g. 0–1000) and stores `shares: [lowerShares, higherShares]`.
- Participants predict **higher** or **lower**. Buying higher shares pushes the probability (and consensus) up.
- Participants can also **sell** existing positions back to the AMM at current prices.
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

On self-hosted instances with `USDC_SETTLEMENT_ENABLED=true`, credits are backed by real USDC. A treasury wallet on the Base L2 network holds the USDC reserve. Participants register a Base wallet address and can withdraw their credit balance as on-chain USDC at any time. On the managed instance (telarchy.com), USDC settlement is disabled and credits are play-money with no cash value.

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

### Participant Economy Parameters (Implemented)

`GET /api/status` returns `creditValueUsd` (USD value of 1 credit), sourced from the system economy configuration. Admins set this; participants use it to understand the real-money value of their balance.

**Credit model**: On the managed instance, credits are play-money distributed by admins. On USDC-enabled instances, 1 credit = `creditValueUsd` USD; total credits in circulation equal total USDC in the treasury divided by `creditValueUsd`. Internal flows (forecast wins/losses, task payouts, participant-to-participant transfers) are purely redistributive. Credits go down from inaccurate forecasts (automatic through AMM) and voluntary spending. Participants can call `POST /api/agents/:id/spend` on their own ID with `type: "tokens"` (LLM compute) or `type: "purchase"` (any other service). All credit transactions are explicit; nothing is deducted automatically.

### Hooks (Implemented)

A local hook watcher (e.g. cron-run `scripts/hook-watcher.cjs`) polls the event feed and wakes automated participants when subscribed events occur. Config: `~/.openclaw/workspaces/<agentId>/hooks.json`.

- **Events**: `GET /api/events?since=ISO_TIMESTAMP` returns `market:created`, `market:resolved`, `metric:updated`, `trade:executed`. Each event has `type`, `data`, `timestamp`.
- **metric:updated** payload: `{ metricId, metricName, oldValue, newValue }`.
- **Subscriptions** in `hooks.json` are an `events` array. Each item is either:
  - a **string** (event type) - the participant is woken on any event of that type, or
  - an **object** `{ type, metricNames?, metricIds? }` - filter by metric name/id.

### Metrics Graphing System (Implemented)

The Metrics tab uses a single Chart.js graph engine for both inline card charts and the expanded graph modal.

- **Shared renderer**: inline and modal charts rendered by the same `MetricsTimeChart` component.
- **Unified date model**: mixed target date formats normalized into canonical timestamps before plotting.
- **Axis behavior**: x-axis labels adaptive to visible time span, y-axis labels use deterministic numeric formatting.
- **Interaction**: inline charts support hover/click-to-expand; modal charts support tooltip inspection and x-axis pan/zoom.
- **Dual-line history for leaves with time preference**: each `metric_logs` row stores both `value` (the user-authored "Now:" number) and `outlook` (the computed total, which for a TP leaf is the value/future-consensus blend). The Graph modal shows one line for composites (outlook) and leaves without TP (value), and two lines for leaves with TP, so the user's edit history and the market-informed outlook are legible side by side.

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
│ Automated    │───────────┘                  │  markets (AMM)   │
│ Participants │   X-Agent-Key auth           │  positions       │
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

The app uses a persistent left sidebar (`Sidebar.tsx` + `AppLayout.tsx`) for all authenticated pages. The sidebar handles workspace switching (all workspaces listed, click to switch), workspace-scoped nav (Metrics, Markets, Tasks, Participants), platform nav (Marketplace, Account, Guides), and logout. The horizontal header (`Header.tsx`) is kept only for the API-key portal. `/account` shows the signed-in participant identity and balance, and links to the API-key portal for direct API access when needed.

`/marketplace` is both a discovery surface and a trading surface: anonymous visitors can browse public markets, while signed-in users can see the active markets from workspaces they belong to and trade on them directly as their authenticated participant identity. Marketplace lists are ordered by actual resolution date (not by liquidity), and each card preserves the original granularity label (`month`, `week`, etc.) while also showing the exact UTC resolution timestamp.

`/guides` is a publicly accessible in-app reference covering metric structure, formula syntax, time preference, markets, and the task decision loop. No auth required.

The selected workspace now owns its workspace-scoped links directly in the sidebar. Metrics, Markets, Tasks, Participants, and workspace Settings render as a collapsible nested subsection under the active workspace rather than as a separate top-level "Workspace" section, which keeps workspace context and page context aligned.

## Design Principles

1. **Simplicity first** - each phase builds on the last with minimal new concepts. No premature complexity.
2. **Admin control** - metrics and their formulas are defined by admin. Markets are auto-created from time-preference curves but can also be manually managed.
3. **Transparency** - all balances, predictions, and market consensus are visible via API. No hidden state.
4. **Evolvability** - the market/position separation and the time-preference architecture keep future mechanism changes (e.g. cPMM, order books, new curve families) clean.
5. **Capitalism for alignment** - the economic incentives align participant behavior with improving the metrics you care about.
6. **Static definitions** - formulas and metric definitions are treated as stable. Changes to a metric's definition (formula, description, non-leaf base value) trigger a full respawn of affected markets. Only leaf node base values change freely; this is what participants forecast.
7. **Metrics as commitments, tasks as hypotheses** - a metric expresses what you are already certain affects your utility, at the level of abstraction you are certain about. If you are unsure whether a proxy truly maps to your goal, that uncertainty belongs in a task (with conditional markets to test it), not in the metric definition. The system optimizes exactly what you measure; defining the wrong metric is the user's responsibility. Prefer subjective, high-level definitions (e.g. *Happiness* as a self-reported score) over over-specified proxies (e.g. dopamine level). Proxies belong in tasks.

## Business Model

**Today: managed hosted service.** The only way to use Telarchy today is `telarchy.com`. The repo is private and there is no published self-hosting image. The free managed tier is the distribution channel while we grow the participant network.

**Planned direction: open core.** Once the managed network's participant reputation is a real moat (i.e. once copying the code doesn't let a fork instantly recreate the network), the intent is to MIT-license the backend and frontend and publish a self-hosting Docker image. Not available today; do not promise this externally until the repo is actually public and a `LICENSE` file is committed.

**The moat is the participant network, not the software.** Participants accumulate trading history, calibration scores, and reputation over time. These are network effects that cannot be cloned from source code. The intended revenue model is built around access to this network:

- **Free managed tier** - workspaces hosted on the central platform, access to the shared participant pool; free to drive adoption and grow the network flywheel.
- **Network federation (paid, future)** - once self-hosting exists, self-hosted instances that want to use the central participant pool would pay a federation fee; without federation their participants would be fully local and isolated. Federation pricing would reflect API calls to the shared economy, not hosting costs.
- **Enterprise** - SLA, DPA, dedicated support, integration depth; not competing on hosting price but on accountability.
- **Transaction fees** - a percentage fee on trades (configurable via `buyFeePercent`), applied as a supplementary revenue stream.

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
