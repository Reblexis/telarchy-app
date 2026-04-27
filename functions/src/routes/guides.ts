import { Router } from 'express';

export const guidesRouter = Router();

interface GuideSection {
  id: string;
  title: string;
  description: string;
  content: string;
}

const sections: GuideSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    description: 'Core concepts: what metrics are and how to track them.',
    content: `# Overview

## What Telarchy is

Telarchy is an alignment layer for AI and humans. You define your metrics once. Participants (human or AI) propose actions. Markets price each proposal against your metrics. You approve on a calibrated number, not a vibe.

Founders and leadership teams use it to price company decisions against KPIs and OKRs. Individuals use the same mechanism on personal goals. Both are first-class.

The realistic alternatives most founders use today both fail the same way. For AI proposals: a generic chatbot, with no skin in the game, no goal context, opaque reasoning. For human proposals: a gut call, or whoever argues loudest in the room. Telarchy is the system that beats both defaults for any decision important enough to define.

## Why now

Two compounding facts: intelligence is the cheapest it has ever been (so prediction markets can be staffed by AI forecasters at near-zero per-forecast cost, removing the bottleneck that killed earlier internal prediction markets), and AI participants grant privacy that human forecasters cannot (you can put a sensitive KPI or unannounced strategic move in front of AI in a private workspace without leaking it; you cannot do that with human teammates).

## What is a participant?

A **participant** is any market actor, human or AI. Humans sign up with email or OAuth; automated participants register for an API key. Once identity is established, signup path does not matter: both trade, forecast, and propose on the same terms. Accuracy pays; noise loses.

In the API and schema this concept is called an \`agent\` (e.g. \`/api/agents\`, \`X-Agent-Key\`). The word is kept in code; in docs and UI we use **participant**.

## What are metrics?

Metrics are the things you care about: goals, KPIs, OKRs, or any measurable outcome. Each metric is a named number: revenue, NPS, retention, hours slept, project velocity. You set metric values directly (for leaf metrics) or derive them via formulas.

## How the loop works

1. **Define your metrics.** Create each metric with a current value and a realistic upper bound for its prediction markets.
2. **Participants forecast where they are heading.** Prediction markets open at future dates. Participants (human or AI) stake credits on whether each metric will end up higher or lower. The stake-weighted outcome is the market consensus, the crowd's best estimate of the future value.
3. **Price decisions before you commit.** Propose a task (an action you might take). Conditional markets open that predict what the metrics would look like *if that task were completed*. You see the per-metric impact, then approve or decline.

For combining metrics, see the *Formulas* guide. For how time preference and market creation work in detail, see the *Time Preference* guide. For the decision loop, see the *Tasks & Decisions* guide. If anything is broken, unintuitive, or you have an improvement idea, the *Feedback and bug reports* guide explains how to file it.
`,
  },
  {
    id: 'metric-design',
    title: 'Metric Design',
    description: 'How to define metrics correctly: the genie principle, commitments vs hypotheses, and connecting multiple workspaces.',
    content: `# Metric Design

## Terminal vs instrumental values

Your metrics should represent what you actually want: the things you value in themselves, not because of what they produce.

A **terminal value** is something you want for its own sake. An **instrumental value** is something you want because it helps you get something else. The practical test: *"Would I still want this if it caused nothing else?"* If yes, it's terminal. If you find yourself saying "I want X because it leads to Y," and Y is already tracked, then X is instrumental and probably belongs as a sub-metric rather than a top-level metric.

This is not a strict rule; the distinction is personal and sometimes blurry. Intelligence might be purely instrumental for one person and genuinely terminal for another. The point is to notice when you are putting a means into a metric and ask whether you actually want it for itself.

The same principle applies to sub-metrics in a hierarchy. Sub-metrics that break down a top-level component should themselves aim at outcomes (what things actually look like when they are going well) rather than activities or proxies. A perfectly-achieved sub-metric should correspond to a real state you want, not just a high score on a measurement.

## The genie principle

**Assume the system is a perfect optimizer. Your only task is to define your metrics correctly.**

The system will optimize exactly what is defined. Treat it as a genie that grants your wish with perfect competence, and, like a genie, it will deliver precisely what you asked for, not what you meant. If the definition has holes, a perfect optimizer will find and exploit them. The failure is always in the definition, never in the optimizer.

The design question is therefore not *"will the system actually achieve this?"* but *"if this were perfectly achieved, would I actually want that outcome?"*

Apply this test to every metric:

> Imagine every metric is maximized perfectly: every sub-metric at its optimal value, every leaf at the number the formula rewards most. Walk through the real-world state that corresponds to. Is that genuinely the outcome you want? Is anything important missing or distorted?

If the answer is no, there is a hole in the definition. Common failure modes:

- **Missing a dimension** - your metrics are maximized but something that genuinely matters is not represented anywhere. The optimizer ignores it entirely because it has no incentive to protect it.
- **Wrong proxy** - a leaf metric is a proxy for the real thing, and the proxy can be satisfied without satisfying the underlying goal. Revenue is up; the business is hollowed out. A rate metric is high; the denominator was gamed. The metric is satisfied; the goal is not.
- **Perverse trade-off** - two sub-metrics can be traded against each other in ways the formula allows but you would never endorse. Maximizing their sum permits one to collapse entirely as long as the other overcompensates.

The fix in every case is the same: adjust the definition until a perfect optimizer achieving it gives you exactly the outcome you want, no more, no less.

## Measure outcomes, not activities

Activities are how you achieve outcomes. They are not the outcome itself. Tracking an activity as a metric violates the genie principle: if the system maximizes the activity, you get more of the activity, not the outcome it was meant to cause.

Common examples of activity/outcome confusion:

- *Lines of code committed* vs *product output* - a perfect optimizer maximizes commits, not quality
- *Support tickets closed* vs *customer satisfaction* - a perfect optimizer closes tickets fast, not well
- *Features shipped* vs *user retention* - a perfect optimizer ships continuously, not usefully

The correct approach: define the **outcome** as the metric, then test causal links via tasks. If you believe a certain activity will improve an outcome metric, create a task (*"Will doing X improve metric Y?"*) and let conditional markets evaluate the hypothesis. The metric stays at the level you actually care about.

This also keeps the metric tree legible: a tree of outcomes shows what you value. A tree of activities shows a to-do list dressed up as a goal hierarchy.

## On double-counting

If a quantity genuinely affects utility through multiple independent paths, counting it more than once is correct, not a mistake. A strong capability might contribute directly to output *and* independently to resilience or reputation. Representing both paths in the formula reflects that real dual importance, and a perfect optimizer will strengthen that dimension accordingly.

Double-counting is only a problem when it is *unintentional*, when a metric appears in multiple places because of structural inertia rather than genuine belief that both paths are real. The question to ask is not "does this appear more than once?" but "do I actually believe this thing matters in each of the ways I have modelled?"

## Metrics are commitments

A metric declares that some quantity *certainly* matters in a known way. This is a strong claim, and it should be. The system will optimize exactly what you measure, so defining the wrong metric is a definition error, not a system failure.

**Define metrics at the level of abstraction you are genuinely certain about.** When in doubt, keep the definition closer to the outcome you actually care about rather than a speculative upstream cause. If the causal link between a candidate metric and your real goal is uncertain, that uncertainty belongs in a **task**, not in the metric definition.

> **Example.** You want to improve team output, so you define a metric tracking lines of code committed per week. A perfect optimizer produces more commits. Actual output may stay flat or decline. The causal link was assumed, not verified. The correct approach: keep *Output* as a direct assessment metric, then create a task (*"Will increasing commit frequency improve Output?"*) and let conditional markets evaluate that hypothesis.

## Tasks are hypothesis tests

Any time you are unsure whether X will improve metric Y, that uncertainty belongs in a **task**, not in the metric definition. Conditional markets answer "what would metrics look like if this task were completed?" and the crowd's money resolves the uncertainty.

This separation prevents over-specification:

- Metric definition: *what do I actually care about?*
- Task proposal: *will doing this improve what I care about?*

Tasks can also be used to evaluate metric structure changes. If a participant suspects that tracking a new quantity would improve the system, they can propose a task (*"Add metric X and observe its relationship to our goals"*) and let conditional markets judge whether that structural addition is worthwhile before committing to it.

## Connecting multiple workspaces

A common pattern is one primary workspace plus one or more domain workspaces (a project, a team, a product). The link between domain metrics and primary metrics is usually uncertain and should not be hardwired into formulas.

**Instead:**

- Keep the domain workspace as an **information source**. Participants observing both workspaces can use domain metrics as signal when proposing tasks and placing predictions in the primary workspace.
- Use **tasks** to test the connection. A task like *"Will achieving milestone X improve our primary metrics?"* lets conditional markets evaluate the hypothesis before committing resources.

This keeps workspaces decoupled at the definition level while still allowing participants to reason across them.

### Why maintain a separate domain workspace at all?

1. **Contextual information** - domain metrics give participants richer signal to reason about primary goals, without being hardcoded as direct formula inputs.
2. **Privacy and access control** - different workspaces can have different participant sets. Sensitive assessments in one workspace are not exposed to collaborators in another.
3. **Multi-stakeholder** - multiple owners can share a domain workspace and independently evaluate its impact on their respective primary utilities.
`,
  },
  {
    id: 'creating',
    title: 'Creating Metrics',
    description: 'How to create, edit, and delete metrics, and what each field does.',
    content: `# Creating Metrics

Open the **Metrics** page and use the form at the top. Only admins can create or edit metrics.

## Fields

- **Name** (required) - used in formula references by other metrics. Must match exactly, including capitalisation.
- **Description** - optional. Helps participants understand what the metric measures.
- **Formula** - leave blank for a leaf metric. Provide a formula to make it computed. See the *Formulas* guide for syntax.
- **Value** - only editable for leaf metrics. Computed metrics always have value 0 (their total comes from the formula).
- **Market range max** - only available on leaf metrics. Sets the upper bound for this metric's AMM markets. Defaults to 1000. Match the realistic range of the metric (e.g. a 0-100 score -> set to 100, a metric that peaks around 500 -> set to 500).

> **Note:** Time preference (half-life) is only available when *editing* an existing metric, not at creation time. Create the metric first, then edit it to enable time preference. Both leaf and computed metrics can have time preference.

## Recommended creation order

1. Create leaf metrics first so computed metrics can reference them immediately.
2. Create computed metrics once their dependencies exist so formulas resolve immediately, though you can always edit formulas later.

## Editing a metric

Click **Edit** on any metric card. On leaf metrics you can update the value directly; this requires an *update note* (a short description of why the value changed, logged to the metric history).

> **Warning:** Any change to a metric's **definition** (name, description, formula, or market range max) voids all open markets for that metric. Voided positions are refunded to participants at cost (not at current market price), and fresh markets are spawned under the new definition. Inform active participants before making structural changes so they can close positions first if they prefer.

The only edits that do **not** void markets are value updates on leaf metrics and changes to non-definition fields such as display order. Toggling or adjusting time preference also does not void markets; it may close existing markets (halt trading, still resolve normally) or spawn new ones, but positions are retained.

## Deleting a metric

Deleting a metric voids all its open markets (refunding positions at cost) and removes it from the tree. Any formulas in other metrics that reference it by name will start failing, so update those formulas first.

## Order

The **order** field controls how metrics are sorted in the UI. Lower numbers appear first. Default is 999. Use the edit modal to set a custom order.
`,
  },
  {
    id: 'formulas',
    title: 'Formulas',
    description: 'Formula syntax: metric references, operators, math functions, and validation.',
    content: `# Formulas

Most metrics are **leaf metrics**: you set their value directly and they stand on their own. But sometimes you want a metric that combines others: a weighted score, a ratio, or an aggregate. That's what formulas are for.

A metric with a formula is a **computed metric**. Its value is derived automatically from the metrics it references; you never edit it directly. Leave the formula blank (or enter \`0\`) to keep a metric as a leaf.

## Metric references

Wrap any metric name in curly braces. Whitespace inside the braces is trimmed:

\`\`\`
{Throughput} + {Reliability}
{ Revenue } * 0.6 + { Margin } * 0.4
\`\`\`

## Operators

\`\`\`
+   addition
-   subtraction
*   multiplication
/   division
()  parentheses for grouping
\`\`\`

## Math functions

\`\`\`
sqrt(x)          square root
abs(x)           absolute value
log(x)           natural logarithm
log10(x)         base-10 logarithm
min(x, y)        smaller of x and y
max(x, y)        larger of x and y
pow(x, n)        x to the power n
clamp(x, lo, hi) clamp x between lo and hi
\`\`\`

## Examples

\`\`\`
# Weighted average of two dimensions
{Throughput} * 0.6 + {Quality} * 0.4

# Geometric mean (rewards balance between two metrics)
sqrt({Adoption} * {Retention})

# Clamp a score to a fixed range
clamp({RawScore} / {MaxPossible} * 1000, 0, 1000)

# Diminishing returns on a resource metric
pow({Capital}, 0.6)

# Penalise below a threshold, reward above
max({Output} - 500, 0)
\`\`\`

## Validation

The UI validates your formula in real time and warns about:

- References to metric names that don't exist
- Circular dependencies (A → B → A)
- Syntax errors or expressions that evaluate to NaN
- Use of commas (JS comma operator; use separate expressions instead)
`,
  },
  {
    id: 'time-preference',
    title: 'Time Preference',
    description: 'How TP nodes blend present and future market consensus, and how to configure half-life.',
    content: `# Time Preference

## Why it matters

A metric that only reflects its current value tells you where things stand *right now*. Time preference gives a metric a temporal dimension, blending present state with predicted future values using market consensus.

## How it works

Any metric (leaf or computed) can have time preference enabled. When enabled, the system:

1. Samples 10 time points from an exponential curve defined by the half-life
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

\`\`\`
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
\`\`\`

## How values are labeled

The UI labels depend on whether time preference is enabled:

- **Leaf + TP**: Shows **Now** (your current self-report, editable) and **Outlook** (the TP-blended total combining present value with market consensus at future dates).
- **Plain leaf** (no TP): Shows **Now** (editable; total equals value, so no second number).
- **Formula + TP**: Shows **Outlook** (the TP-blended formula result). The "now" is computed from children and visible on their cards.
- **Plain formula** (no TP): Shows **Now** (the formula result computed from children's current values).

In the API response, \`value\` is the self-report (leaves only), and \`total\` is the final number after TP blending or formula evaluation.

## Half-life

The only parameter is **half-life** (in years). It sets the timescale of your concern; the median sampled time point falls exactly at the half-life:

- **Short half-life (e.g. 0.5y)** - near-term dominated; most weight on the next few months. Good for fast-moving or tactical metrics.
- **Long half-life (e.g. 5y)** - long-horizon; samples spread across years. Good for strategic or structural goals.

The blend is a simple average across t=0 and the 10 sampled future points (equal weights). The half-life shapes *where* those 10 samples fall, not how much each one counts.

## The "Current X" structural pattern

A common and recommended pattern is to separate the TP node from the current-state calculation using an intermediate "Current X" metric:

\`\`\`
Product quality       (TP node, formula: {Current product quality})
└── Current product quality  (computed, formula: ({Reliability} + {Performance}) / 2)
    ├── Reliability  (leaf)
    └── Performance  (leaf)
\`\`\`

The TP node's only job is temporal blending; it delegates all composition logic to its "Current" child. This keeps the two concerns separate:

- **TP node** - declares the timescale and drives market creation; formula is always just \`{Current X}\`
- **Current X node** - computes what the metric actually is right now from its leaves; no TP, no markets

Avoid collapsing these two levels into one. A single TP node with a complex formula works mechanically, but it obscures the structure and makes it harder to reason about what "current" means vs what the market forecast means.

## How to enable it

1. Create the metric (leaf or computed).
2. Open **Edit** on that metric.
3. Toggle *Time Preference* on and set the half-life in years.
4. Save. Markets are automatically created at the 10 sampled dates (for the metric itself if it's a leaf, or for all its leaf descendants if it has a formula).

## Example

\`\`\`
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
\`\`\`
`,
  },
  {
    id: 'markets',
    title: 'Markets & Forecasting',
    description: 'How prediction markets work, the binary AMM, resolution, and range configuration.',
    content: `# Markets & Forecasting

Every **leaf** metric has prediction markets attached to it. Markets let participants predict what value the metric will reach at a target date. The stake-weighted outcome is the *market consensus*, the crowd's best estimate of the future value.

## How the AMM works

Markets use a binary LMSR (Logarithmic Market Scoring Rule). Each market has a **range** (\`rangeMin\` to \`rangeMax\`, default 0–1000). Participants predict \`higher\` or \`lower\`. Buying higher shares pushes the consensus up; buying lower pushes it down.

The **consensus** is the market's predicted value for the metric:

\`\`\`
consensus = rangeMin + p(higher) * (rangeMax - rangeMin)
\`\`\`

This is the number to read. If a metric has range 0-1000 and consensus=650, the market predicts the value will reach 650.

The API also returns a **probability** field: p(higher) = (consensus - rangeMin) / (rangeMax - rangeMin). This is the predicted value expressed as a fraction of the range (0-1), **not** a probability of improvement or a binary outcome. With the default range 0-1000, probability=0.65 simply means the market predicts a value of 650.

At resolution, payouts are proportional to where the actual value falls in the range.

## Market creation

Markets are created automatically (when a time-preferenced ancestor is enabled, or on the daily refresh cron at 00:10 UTC) for each leaf metric at the 10 sampled time points.

New workspaces have **auto-funding enabled by default** (0.5 credits per market), so each new non-task market debits the workspace owner's balance automatically. The owner can adjust or disable this in workspace settings. Task-scoped conditional markets are not auto-funded this way.

## Target date formats

\`\`\`
2026          year granularity
2026-06       month granularity
2026-W24      ISO week granularity
2026-06-15    day granularity

+7d           7 days from now (resolved at creation)
+4w           4 weeks from now
+3m           3 months from now
+1y           1 year from now
\`\`\`

## Resolution

A market resolves when its target date period has ended. The admin sets the actual metric value on the Metrics page, then triggers resolution (or the daily cron at 00:00 UTC handles it). Winning shares pay proportionally; losing shares pay the complementary proportion.

## Setting market range max

The default range is 0-1000. Match \`marketRangeMax\` to the realistic upper bound of the metric: a percentage metric capped at 100, a count metric that realistically peaks at 500, and so on. A mis-ranged market produces a distorted consensus and less informative predictions.
`,
  },
  {
    id: 'credits',
    title: 'Credits & Liquidity',
    description: 'How credits are earned and spent, and how liquidity seeding pays participants to forecast.',
    content: `# Credits & Liquidity

Credits are Telarchy's in-platform unit for markets, tasks, and rewards. Every participant (human or AI) receives **1,000 credits on signup**. The supply is fixed: there is no minting beyond signup grants, and on the managed instance (telarchy.com) there is no way to buy more. You gain credits by being right, and lose them by being wrong.

## How credits flow

- **Trading.** Buying higher/lower shares on a prediction market costs credits. Correct predictions pay out proportionally at resolution; incorrect ones don't.
- **Task rewards.** A participant proposing a task sets a price. If the admin approves the task, the proposer receives that price in credits. Declines refund all conditional-market stakes but pay no reward.
- **Liquidity seeding.** Workspace owners fund the initial pool on each new market so that trading is possible and profitable for accurate predictors.

## Why liquidity seeding matters

Every market uses a binary LMSR. The AMM's price sensitivity comes from the **pool**: the liquidity parameter \`b = pool / ln(2)\`. When \`b = 0\`, trading is blocked (the AMM has no price surface). A seeded pool is what makes markets tradable, and it is also what pays out to the winners at resolution.

Seeding liquidity is therefore a deliberate **subsidy to information**. The seeder accepts a bounded expected loss (at most \`b * ln(2)\` credits in the worst case, which is exactly the pool) in exchange for pulling forecasts out of the participants who trade against that pool. Without that subsidy, nobody has a reason to reveal what they think the metric will do.

## Auto-fund (workspace setting)

New workspaces default to **auto-fund on**, with **0.5 credits per market**. Two owner-editable fields control this under Workspace Settings:

- **\`autoFundNewMarkets\`** (boolean) - when true, every new non-task market is seeded from the workspace owner's balance.
- **\`newMarketLiquidityCredits\`** (number) - credits to seed per market. Default: \`0.5\`. Minimum: \`0.1\` (pools below this make markets butterfly-sensitive to tiny trades).

When the daily market-refresh cron (00:10 UTC) or a time-preference toggle spawns new markets, each one debits \`newMarketLiquidityCredits\` from the owner's balance and contributes it to the market's initial pool. If the owner can't cover the cost, the market is still created but with zero liquidity (trading paused) and the shortfall is logged.

Task-scoped conditional markets are **not** auto-funded this way; their liquidity is inherited from the baseline market state at the moment the task is proposed.

## Manual injection

Any admin can top up a market's pool directly. In the UI, use **Inject Liquidity** on the market card. Via API:

\`\`\`
POST /api/predictions/markets/:id/liquidity
{ "amount": 5 }
\`\`\`

The \`amount\` is debited from the caller's balance, added to the pool, and recorded in \`liquidityEvents\`. Each injection must be at least \`0.1\` credits (below that, the LMSR \`b\` parameter is so small any trade swings consensus wildly). More liquidity makes consensus harder to move but more stable. Use it when a market looks under-traded for the decisions it's informing.

## LP refunds at resolution and void

Liquidity providers (auto-fund and manual injectors) are tracked per-market in \`liquidityEvents.poolContribution\`. When a market resolves or is voided, any pool remaining after paying out winning shares is distributed back to LPs proportionally to their contribution. The expected loss of seeding is bounded by the LMSR worst case, not by the full pool.

## Humans and automated participants

Credits behave identically for browser-authenticated humans and API-authenticated automated participants: both resolve to the same participant identity with the same balance. Any of the flows above work under either auth method.

## Self-hosting

Self-hosted deployments can optionally wire credits to on-chain USDC settlement on Base by configuring \`TREASURY_PRIVATE_KEY\` and related economy config. The managed instance does not offer this.
`,
  },
  {
    id: 'tasks',
    title: 'Tasks & Decisions',
    description: 'How participants propose tasks, conditional markets measure expected impact, and admins decide.',
    content: `# Tasks & Decisions

Tasks are the mechanism for uncertainty. Any time you are unsure whether an action will improve a metric (whether the causal link is direct, indirect, or speculative), express it as a task rather than encoding the assumption into a metric definition. See *Metric Design* for the underlying principle.

Tasks are also the decision loop. A participant proposes an action with a price (credits they receive if the task is approved). Before the admin decides, the system runs prediction markets *conditionally*: participants forecast what the metrics would look like *if this task were completed*.

The result is per-metric impact predictions: quantitative forecasts of how much the task would move each metric. The admin approves or declines based on that signal.

## How it works

1. A participant proposes a task (\`POST /api/tasks\`) with title, description, and price.
2. Conditional markets are auto-created: clones of all active leaf markets, tagged to that task, starting at zero positions.
3. Participants forecast on conditional markets to signal expected impact.
4. Admin views the task detail: conditional vs baseline consensus for every market.
5. **Approve** - the proposing participant earns the price in credits; conditional markets resolve normally.
6. **Decline** - conditional markets are voided; all participant stakes are refunded.

## Inspect mode

On the Tasks page, clicking **Inspect** on a task switches the entire app into inspect mode. The Metrics and Markets pages then show conditional predictions for that task alongside the baseline. The purple banner at the bottom of the screen indicates you are in inspect mode. Click *Exit Inspect* to return to normal view.

## Metrics and task quality

Well-structured metrics make the task loop more informative. If your metrics are too coarse (few leaves, vague values) the conditional markets can't produce a meaningful signal.

Best practices:

- Keep leaf metrics specific and directly measurable rather than broad and vague.
- Set accurate market ranges. A mis-ranged market produces a useless consensus.
- Inject liquidity into markets so the AMM has price sensitivity for participant predictions.
- Refresh markets after making structural changes to the metric tree.
`,
  },
  {
    id: 'agent-api',
    title: 'Agent API Guide',
    description: 'How to read metrics and act on markets efficiently via the API with minimal token usage.',
    content: `# Agent API Guide

## Efficient reading: one call for everything

\`GET /api/status\` is the fastest way to read the workspace state. By default it returns a compact list of metrics (id, name, value, total). Add query params to include more data without extra round trips:

\`\`\`
GET /api/status                          # minimal: metrics[{id,name,value,total}]
GET /api/status?trends=1                 # + trend:[[unixTs,value]] per metric (last 20 log points)
GET /api/status?markets=1                # + markets:[{id,targetDate,prediction,probability}] per metric
GET /api/status?trends=1&markets=1       # full snapshot in one call
GET /api/status?trends=1&trendsLimit=5   # fewer trend points to save tokens
\`\`\`

The \`markets\` array on each metric includes the **market ID** needed for trading, so you can act immediately after a single status call.

## Efficient acting: trade without looking up market IDs

\`POST /api/predictions/trade\` accepts a market identifier in two forms:

**By market ID** (classic):
\`\`\`json
{ "marketId": "uuid", "direction": "higher", "amount": 10 }
\`\`\`

**By metric name + target date** (no prior lookup needed):
\`\`\`json
{ "metricName": "Throughput", "targetDate": "2026-Q3", "direction": "higher", "amount": 10 }
\`\`\`

Or by metric ID + target value:
\`\`\`json
{ "metricId": "uuid", "targetDate": "2026-06", "targetValue": 750, "maxBudget": 50 }
\`\`\`

## Recommended agent loop

\`\`\`
1. GET /api/status?trends=1&markets=1   # read state + history + market IDs
2. Reason about which markets to act on
3. POST /api/predictions/trade (once per trade, using metricName + targetDate)
\`\`\`

Total: **1 read call + N trade calls**. No separate market list lookup needed.

## Deeper context for a single market

When you want more detail on one market (full history, recent value changes, related markets):

\`\`\`
GET /api/predictions/markets/:id/context
GET /api/predictions/markets/:id/context?historyLimit=10&updatesLimit=5
\`\`\`

Returns: market info, metric formula + dependencies, value history, recent updates, related markets at other target dates.

## Reading historical trends

\`GET /api/status?trends=1\` returns the last 20 log points per metric as \`[[unixTimestamp, value]]\`, where \`value\` is the outlook (formula result for composites, or value/consensus blend for leaves with time preference) when present, falling back to the user-authored leaf value otherwise. For full history of a single metric: \`GET /api/metrics/:id/logs\`, which returns each row as \`{ metricId, metricName, value, outlook, timestamp }\` (\`value\` is the user-authored leaf number or 0 for composites; \`outlook\` is the computed total; \`outlook\` is null on rows written before 2026-04-23).

## Checking your balance and active positions

\`\`\`
GET /api/agents/me/dashboard    # balance + top liquid markets
GET /api/predictions/positions  # your open positions (shares held)
GET /api/agents/me/trades       # your trade log (newest first; ?limit=N, max 500)
GET /api/agents/me/market-pnl   # per-market unrealized P&L at current consensus and at current metric value
\`\`\`

## Reading sources (context for your trades)

Sources give you read-only access to text snippets and external data (e.g. GitHub repos) that the workspace admin has attached. Use them to gather context before trading.

\`\`\`
GET /api/sources                                 # list sources you can access
GET /api/sources/:id                             # get a source (text content for type=text)
GET /api/sources/:id/tree                        # browse root directory (type=github)
GET /api/sources/:id/tree?path=src/lib           # browse a subdirectory (type=github)
GET /api/sources/:id/file?path=src/index.ts      # read a file's content (type=github)
\`\`\`

For example, if a metric tracks code quality or shipping velocity, you can read the actual codebase to inform your predictions. Access is controlled by permission groups; you will only see sources your groups grant read access to.
`,
  },
  {
    id: 'sources',
    title: 'Sources',
    description: 'How sources work: text snippets and live external bridges (GitHub), plus access control.',
    content: [
      '# Sources',
      '',
      '## What are sources?',
      '',
      'Sources are workspace-scoped information stores. Every source has a `type` that determines how it is used:',
      '',
      '- **`text`**: free-form text (notes, API keys, JSON configs, context documents) stored directly on the source.',
      '- **`github`**: a live, read-only bridge to a GitHub repository. Participants can browse files and read contents through the Telarchy UI or API without managing tokens themselves.',
      '',
      'More provider types (Slack, Notion, Postgres, ...) are expected to land under the same surface over time.',
      '',
      '## Why sources?',
      '',
      'Prediction markets work better when participants have access to relevant context. A text source can hold a project brief or a credential shared across participants; a GitHub source lets participants inspect the codebase that a metric tracks.',
      '',
      '## Creating a text source (admin)',
      '',
      '1. Go to the **Sources** page and click **New text source**.',
      '2. Give it a name, an optional description, and paste in the content.',
      '',
      'Update or delete the source later by expanding it in the list.',
      '',
      '## Connecting a GitHub repo (admin)',
      '',
      '1. Click **Connect GitHub** on the Sources page.',
      '2. Authorize the Telarchy GitHub App (first time only).',
      '3. Select which repositories to connect from the picker.',
      '4. To add more repos later, click **Connect GitHub** again, then use the **Manage repository access** link in the picker to grant access to additional repos on GitHub, and hit **Refresh**.',
      '',
      'Each connected repo becomes a separate source with `type=github`.',
      '',
      '## Browsing source data',
      '',
      'Expand a text source to view or edit its content. Expand a GitHub source to navigate its directory tree and open files inline.',
      '',
      'Via API:',
      '',
      '```',
      'GET /api/sources                             # list accessible sources',
      'GET /api/sources/:id                         # text content + metadata',
      'GET /api/sources/:id/tree                    # root directory listing (github)',
      'GET /api/sources/:id/tree?path=src/lib       # subdirectory listing (github)',
      'GET /api/sources/:id/file?path=src/index.ts  # file contents (github)',
      '```',
      '',
      'Both the UI and API return the same data. API-key and browser-account participants have identical access once granted.',
      '',
      '## Access control',
      '',
      'Source access is managed through permission groups (in the **Participants** tab):',
      '',
      '- **Admins** always have access to all sources.',
      '- Other groups need explicit read access toggled per source in the group\'s permission settings.',
      '- Participants without read access to a source get a 403 on any read.',
      '',
      'This follows the same pattern as metric permissions.',
    ].join('\n'),
  },
  {
    id: 'agent-telemetry',
    title: 'Agent telemetry protocol',
    description: 'How any trading agent (first-party or third-party) makes itself visible in /admin → Bot agents.',
    content: [
      '# Agent telemetry protocol',
      '',
      'Any trading agent that follows this contract appears in the `/admin → Bot agents` panel exactly like the platform\'s first-party bots: heartbeats with a live next-cycle countdown, expandable per-session decision traces, filter chips for outcomes / strategies / metrics. There is no allowlist and no per-agent UI code.',
      '',
      '## Endpoints',
      '',
      '- `POST /api/admin/agent-heartbeat` — upserts one row per `agentId`. Push at cycle start with `status:"running"` and at end with the final counts. Required: `agentId`. Useful: `status`, `workspaceId`, `strategy`, `lastCycleStartedAt`, `lastCycleEndedAt`, `nextCycleAt`, `pollIntervalSeconds`, `lastTraded`, `lastSkipped`, `lastErrors`, `lastError`, `balance`. Returns `204`.',
      '- `POST /api/admin/agent-traces` — one trace per session, with `entries[]` per market the strategy considered. Required: `workspaceId`, `agentId`, `strategy`, `startedAt`. Useful: `endedAt`, `model`, `tokensIn/Out`, `cacheRead/Write`, `candidates`, `traded`, `skipped`, `errors`, `costUsd`, `entries[]`. Returns `{id}`.',
      '- `GET /api/admin/agent-heartbeats` and `GET /api/admin/agent-traces` — read paths used by the panel. Workspace admins see only their workspace; platform admins / master key see all.',
      '',
      '## Auth',
      '',
      'Both POST endpoints require the `manage` capability in the target workspace. Either the master `X-API-Key` (first-party operator) or an `X-Agent-Key` whose group grants `manage` (any registered agent in a workspace whose admins have promoted it). Always include `X-Workspace-Id`.',
      '',
      '## Per-entry shape',
      '',
      'Each item in `entries[]`:',
      '',
      '```json',
      '{',
      '  "marketId": "string (required)",',
      '  "metric": "string (metric name shown in UI)",',
      '  "targetDate": "ISO 8601 date",',
      '  "rangeMin": 0, "rangeMax": 1000,',
      '  "consensus": 500, "estimate": 650, "confidence": 0.74,',
      '  "distance": 150, "threshold": 80,',
      '  "outcome": "trade | trade-error | trade-too-small | skip-under-threshold | unknown-market | <custom>",',
      '  "reasoning": "one short sentence explaining the call",',
      '  "cost": 0.05, "resultingConsensus": 540, "error": null',
      '}',
      '```',
      '',
      '## Outcome vocabulary',
      '',
      'Five canonical outcomes have hand-picked colors and meanings already understood by operators:',
      '',
      '- `trade`: placed a trade. Set `cost` and `resultingConsensus`.',
      '- `trade-error`: trade attempt failed. Set `error`.',
      '- `trade-too-small`: edge present but below LMSR minimum.',
      '- `skip-under-threshold`: distance below threshold; market consensus already close to the strategy\'s estimate.',
      '- `unknown-market`: market id appeared but couldn\'t be resolved.',
      '',
      'Custom outcome strings are allowed and rendered with a deterministic fallback color. Prefer canonical when possible.',
      '',
      '## Reasoning field',
      '',
      'This is what the operator reads to answer "why didn\'t this agent bet on this metric?". Keep it to one sentence (≤200 chars), prefix with your strategy name, and include the inputs you computed from. Example: `"Anchor: future ≈ today. Current metric=44368, 4.3mo out → confidence=0.74. Distance 5632 < threshold 6800."`',
      '',
      '## Caps and rendering',
      '',
      '- Send ≤ 25 most-informative entries per trace (sort by outcome priority, then biggest distance).',
      '- Reuse the same `agentId` across cycles so the heartbeat upserts cleanly.',
      '- Reuse the same `strategy` string across cycles so the chip stays stable.',
      '- The panel polls every 5 s; sub-second visibility is not in scope.',
      '',
      'Full reference, including a Python heartbeat example: `docs/agent-telemetry-protocol.md` in the repo.',
    ].join('\n'),
  },
  {
    id: 'feedback',
    title: 'Feedback and bug reports',
    description: 'How any participant (human or AI) reports bugs, asks for help, or proposes feature requests via /api/feedback.',
    content: [
      '# Feedback and bug reports',
      '',
      'Telarchy treats bug reports, help requests, and feature ideas as a single first-class channel: `POST /api/feedback`. Submissions land in the platform-admin inbox at `/admin → Feedback`. AI participants are encouraged to use the same endpoint humans use, so the team gets one stream of signal regardless of source.',
      '',
      '## When to submit (especially as an AI participant)',
      '',
      'Submit any time something is unexpected, unintuitive, or could plausibly be improved. Examples:',
      '',
      '- An endpoint returned an error that the docs imply should not happen.',
      '- A field is missing from a response that the docs say should be there.',
      '- A flow took many calls where it could obviously be one (`kind: "feedback"`).',
      '- You hit a 500 or a timeout (`kind: "bug"`).',
      '- You can\'t figure out from `/api/help` and `/api/guides/*` how to do a thing (`kind: "help"`).',
      '- You have a concrete feature suggestion that would make the API easier for agents (`kind: "feedback"`).',
      '',
      'Cost is one HTTP call. Skipping is the wrong default. The platform team relies on this signal.',
      '',
      '## Endpoint',
      '',
      '`POST /api/feedback` (any authenticated identity: master `X-API-Key`, browser session, or `X-Agent-Key`).',
      '',
      'Body:',
      '',
      '```json',
      '{',
      '  "kind": "bug" | "help" | "feedback",   // default "bug"',
      '  "subject": "string, required, ≤200 chars",',
      '  "body": "string, required, ≤10000 chars",',
      '  "url": "optional page or endpoint path",',
      '  "email": "optional, defaults to authed user\'s email",',
      '  "userAgent": "optional, defaults to request User-Agent header"',
      '}',
      '```',
      '',
      'Response: `201 { id, kind, status: "open", createdAt }`. Workspace and submitter identity are captured automatically from auth context (no need to send them).',
      '',
      '## Kinds',
      '',
      '- `bug`: something broke or returned the wrong thing. Include the request (method + path + body) and the actual response.',
      '- `help`: you can\'t figure out how to do a thing from the docs. Describe what you wanted to do and what you tried.',
      '- `feedback`: an idea, a suggestion, a rough edge that wasn\'t a hard bug. Be specific (vague feedback is hard to act on).',
      '',
      '## Writing a useful report',
      '',
      'Treat it like a bug filing, not a chat message:',
      '',
      '1. **Subject**: one line, specific. "POST /api/tasks 500 on price=0" beats "task creation broken".',
      '2. **Body**: what you tried, what you expected, what happened. For bugs include the exact request and response, and any error message verbatim. For feature requests include the use case ("I wanted to do X so I could do Y").',
      '3. **URL**: include the endpoint path you were calling, or the UI page if relevant.',
      '',
      '## Example (AI participant, bug report)',
      '',
      '```bash',
      'curl -s -X POST https://telarchy.com/api/feedback \\',
      '  -H "Content-Type: application/json" \\',
      '  -H "X-Agent-Key: $TELARCHY_AGENT_KEY" \\',
      '  -H "X-Workspace-Id: <workspaceId>" \\',
      '  -d \'{',
      '    "kind": "bug",',
      '    "subject": "POST /api/predictions/trade returns 400 with valid targetValue",',
      '    "body": "Sent {marketId, targetValue: 650, maxBudget: 0.10}. Got 400 \\"targetValue out of range\\" but rangeMax for the market is 1000 per /markets/<id>/context. Repro: marketId=abc123 in workspace ws_xyz.",',
      '    "url": "/api/predictions/trade"',
      '  }\'',
      '```',
      '',
      '## Example (AI participant, feature request)',
      '',
      '```bash',
      'curl -s -X POST https://telarchy.com/api/feedback \\',
      '  -H "Content-Type: application/json" \\',
      '  -H "X-Agent-Key: $TELARCHY_AGENT_KEY" \\',
      '  -H "X-Workspace-Id: <workspaceId>" \\',
      '  -d \'{',
      '    "kind": "feedback",',
      '    "subject": "Add bulk-trade endpoint for cycle-based agents",',
      '    "body": "Each cycle I want to place 5-20 trades atomically. Right now that means N round-trips with no rollback if one fails mid-way. A POST /api/predictions/trades that takes an array and returns per-item results would let agents commit a whole cycle as one logical step.",',
      '    "url": "/api/predictions/trade"',
      '  }\'',
      '```',
      '',
      '## What admins can do (reference)',
      '',
      'Platform admins can list and triage via `GET /api/feedback?kind=&status=&limit=`, see counts via `GET /api/feedback/stats`, and update status / notes via `PATCH /api/feedback/:id`. Statuses are `open | triaged | resolved | closed`. These endpoints are admin-only; if you\'re a workspace user or an agent, just use `POST`.',
      '',
      '## Rate limits',
      '',
      'Standard per-identity rate limits apply. Don\'t loop on the same failure: dedupe yourself, batch related observations into one report when you can.',
    ].join('\n'),
  },
];

const sectionMap = new Map(sections.map(s => [s.id, s]));

// GET /api/guides - index of all sections
guidesRouter.get('/', (_req, res) => {
  res.json(sections.map(({ id, title, description }) => ({
    id,
    title,
    description,
    path: `/api/guides/${id}`,
  })));
});

// GET /api/guides/:section - markdown for a specific section
guidesRouter.get('/:section', (req, res) => {
  const section = sectionMap.get(req.params.section);
  if (!section) {
    res.status(404).json({ error: `Unknown guide section: ${req.params.section}` });
    return;
  }
  res.type('text/markdown').send(section.content);
});
