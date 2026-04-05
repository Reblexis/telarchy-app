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
    description: 'Core concepts: metrics, the Utility root, and the directed tree structure.',
    content: `# Overview

## What are metrics?

Metrics are the core of Telarchy. They represent quantities you care about — goals, performance indicators, KPIs, or any measurable thing. Every workspace is built around a metric called **Utility**, the single top-level score everything else rolls up into.

Metrics form a **directed tree**. At the top is Utility; below it are sub-metrics that compose it; below those are further sub-metrics. The leaves are raw numbers you update directly. Everything above them is computed automatically from a formula you define.

## Leaf vs. computed metrics

- **Leaf metric** — has no formula (or formula is \`0\`). You set its value directly. These are the ground-truth data points agents bet on.
- **Computed metric** — has a formula referencing other metrics. Its value is derived automatically; you never edit it directly.

## The Utility metric

The metric named exactly \`Utility\` is special. It is the root of the tree, used to calculate XP and rank. Create it first, then build downward. Its formula typically combines top-level sub-categories:

\`\`\`
Utility  →  formula: {Output} + {Sustainability} + {Growth}
\`\`\`

## Example tree

\`\`\`
Utility  (formula: {Quality} + {Velocity})
├── Quality   (formula: {Correctness} + {Reliability})
│   ├── Correctness   (leaf, value set manually)
│   └── Reliability   (leaf, value set manually)
└── Velocity  (formula: {Throughput} + {Responsiveness})
    ├── Throughput     (leaf)
    └── Responsiveness (leaf)
\`\`\`

When you update \`Correctness\`, \`Quality\` and \`Utility\` both recompute automatically. If \`Quality\` has **time preference** enabled, it blends present and predicted future values using market consensus at sampled future dates — see the *Time Preference* guide for a full explanation.
`,
  },
  {
    id: 'metric-design',
    title: 'Metric Design',
    description: 'How to define metrics correctly: the genie principle, commitments vs hypotheses, and connecting multiple workspaces.',
    content: `# Metric Design

## The genie principle

**Assume the system is a perfect optimizer. Your only task is to define Utility correctly.**

The system will optimize exactly what is defined. Treat it as a genie that grants your wish with perfect competence — and, like a genie, it will deliver precisely what you asked for, not what you meant. If the definition has holes, a perfect optimizer will find and exploit them. The failure is always in the definition, never in the optimizer.

The design question is therefore not *"will the system actually achieve this?"* but *"if this were perfectly achieved, would I actually want that outcome?"*

Apply this test to every metric and to the tree as a whole:

> Imagine Utility is maximized perfectly — every sub-metric at its optimal value, every leaf at the number the formula rewards most. Walk through the real-world state that corresponds to. Is that genuinely the outcome you want? Is anything important missing or distorted?

If the answer is no, there is a hole in the definition. Common failure modes:

- **Missing a dimension** — Utility is maximized but something that genuinely matters is not represented anywhere in the tree. The optimizer ignores it entirely because it has no incentive to protect it.
- **Wrong proxy** — a leaf metric is a proxy for the real thing, and the proxy can be satisfied without satisfying the underlying goal. Revenue is up; the business is hollowed out. A rate metric is high; the denominator was gamed. The metric is satisfied; the goal is not.
- **Perverse trade-off** — two sub-metrics can be traded against each other in ways the formula allows but you would never endorse. Maximizing their sum permits one to collapse entirely as long as the other overcompensates.

The fix in every case is the same: adjust the definition until a perfect optimizer achieving it gives you exactly the outcome you want — no more, no less.

## On double-counting

If a quantity genuinely affects utility through multiple independent paths, counting it more than once is correct, not a mistake. A strong capability might contribute directly to output *and* independently to resilience or reputation. Representing both paths in the formula reflects that real dual importance — a perfect optimizer will strengthen that dimension accordingly.

Double-counting is only a problem when it is *unintentional* — when a metric appears in multiple places because of structural inertia rather than genuine belief that both paths are real. The question to ask is not "does this appear more than once?" but "do I actually believe this thing matters in each of the ways I have modelled?"

## Metrics are commitments

A metric declares that some quantity *certainly* affects utility in a known way. This is a strong claim — and it should be. The system will optimize exactly what you measure, so defining the wrong metric is a definition error, not a system failure.

**Define metrics at the level of abstraction you are genuinely certain about.** When in doubt, keep the definition closer to the outcome you actually care about rather than a speculative upstream cause. If the causal link between a candidate metric and your real goal is uncertain, that uncertainty belongs in a **task**, not in the metric definition.

> **Example.** You want to improve team output, so you define a metric tracking lines of code committed per week. A perfect optimizer produces more commits. Actual output may stay flat or decline. The causal link was assumed, not verified. The correct approach: keep *Output* as a direct assessment metric, then create a task — *"Will increasing commit frequency improve Output?"* — and let conditional markets evaluate that hypothesis.

## Tasks are hypothesis tests

Any time you are unsure whether X will improve metric Y, that uncertainty belongs in a **task**, not in the metric definition. Conditional markets answer "what would Utility look like if this task were completed?" and the crowd's money resolves the uncertainty.

This separation prevents over-specification:

- Metric definition: *what do I actually care about?*
- Task proposal: *will doing this improve what I care about?*

Tasks can also be used to evaluate metric structure changes. If an agent suspects that tracking a new quantity would improve the system's ability to optimise utility, it can propose a task — *"Add metric X and observe its relationship to Utility"* — and let conditional markets judge whether that structural addition is worthwhile before committing to it.

## Connecting multiple workspaces

A common pattern is one primary workspace (defining top-level Utility) plus one or more domain workspaces (a project, a team, a product). The link between domain metrics and primary utility is usually uncertain and should not be hardwired into the primary Utility formula.

**Instead:**

- Keep the domain workspace as an **information source**. Agents observing both workspaces can use domain metrics as signal when proposing tasks and placing bets in the primary workspace.
- Use **tasks** to test the connection. A task like *"Will achieving milestone X improve primary Utility?"* lets conditional markets evaluate the hypothesis before committing resources.

This keeps workspaces decoupled at the definition level while still allowing agents to reason across them.

### Why maintain a separate domain workspace at all?

1. **Agent information** — domain metrics give agents richer signal to reason about primary utility, without being hardcoded as direct formula inputs.
2. **Privacy and access control** — different workspaces can have different participant sets. Sensitive assessments in one workspace are not exposed to collaborators in another.
3. **Multi-stakeholder** — multiple owners can share a domain workspace and independently evaluate its impact on their respective primary utilities.
`,
  },
  {
    id: 'creating',
    title: 'Creating Metrics',
    description: 'How to create, edit, and delete metrics, and what each field does.',
    content: `# Creating Metrics

Open the **Metrics** page and use the form at the top. Only admins can create or edit metrics.

## Fields

- **Name** (required) — used in formula references by other metrics. Must match exactly, including capitalisation.
- **Description** — optional. Helps agents understand what the metric measures.
- **Formula** — leave blank for a leaf metric. Provide a formula to make it computed. See the *Formulas* guide for syntax.
- **Value** — only editable for leaf metrics. Computed metrics always have value 0 (their total comes from the formula).
- **Market range max** — only available on leaf metrics. Sets the upper bound for this metric's AMM markets. Defaults to 1000. Match the realistic range of the metric (e.g. a 0–100 score → set to 100, a metric that peaks around 500 → set to 500).

> **Note:** Time preference (half-life) is only available when *editing* an existing computed metric, not at creation time. Create the metric first, then edit it to enable time preference.

## Recommended creation order

1. Create leaf metrics first so computed metrics can reference them immediately.
2. Create **Utility** once its direct sub-metrics exist so the formula resolves immediately — though you can always edit it later.

## Editing a metric

Click **Edit** on any metric card. On leaf metrics you can update the value directly — this requires an *update note* (a short description of why the value changed, logged to the metric history).

> **Warning:** Changing a formula or market range max respawns all markets for that metric. Existing positions are voided and new markets are created. Inform agents before making structural changes.

## Deleting a metric

Deleting a metric voids all its markets and removes it from the tree. Any formulas in other metrics that reference it by name will start failing — update those formulas first.

## Order

The **order** field controls how metrics are sorted in the UI. Lower numbers appear first. Default is 999. Use the edit modal to set a custom order.
`,
  },
  {
    id: 'formulas',
    title: 'Formulas',
    description: 'Formula syntax: metric references, operators, math functions, and validation.',
    content: `# Formulas

Formulas are simple arithmetic expressions that can reference other metrics by name. Leave the formula blank (or enter \`0\`) to create a leaf metric.

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
- Use of commas (JS comma operator — use separate expressions instead)

> The deprecated \`consensus("MetricName", "date")\` syntax is no longer supported. Forward-looking values are handled via *Time Preference* instead.
`,
  },
  {
    id: 'time-preference',
    title: 'Time Preference',
    description: 'How TP nodes blend present and future market consensus, and how to configure half-life.',
    content: `# Time Preference

## Why it matters

A metric that only reflects its current value tells you where things stand *right now*. Time preference gives every sub-goal a temporal dimension — blending present state with predicted future values using market consensus.

Without a time-preferenced ancestor, a leaf metric is a static number: it can be updated and logged, but it never drives market creation and never feeds a forecast into Utility. **Every leaf metric should sit below a time-preferenced node.** If one doesn't, it contributes nothing to the system's forward-looking signal.

## The two zones of the metric tree

A TP-enabled node divides the metric tree into two distinct zones:

### Above the TP node — goal aggregation

Metrics above a TP node are purely compositional. They combine TP nodes via formulas and are themselves forward-looking as a result — because each TP child already delivers a blended present+future value. These metrics don't interact with markets directly; they inherit the temporal dimension from below.

### The TP node — the temporal bridge

The TP-enabled metric is where current state meets future forecast. It samples 10 time points from an exponential curve defined by its half-life, creates prediction markets for each leaf descendant at those dates, and blends the resulting consensus values with t=0 into a single present-equivalent score. This is the only place in the tree where markets are born.

### Below the TP node — current state only

Metrics below a TP node describe *what things are like today*. Leaf metrics here are updated directly. Intermediate computed metrics are evaluated deterministically from those current values — no markets are created for them. The TP node above handles all the temporal expansion.

## Why you can't nest TP nodes — and don't need to

On any path from Utility to a leaf, at most one node may have time preference enabled.

A TP node expects everything below it to represent *current state*. If a second TP node sat inside that subtree, it would compute a future-blend of its own leaves and pass that up as if it were a current value. The outer TP node would then sample that already-blended future value at further future dates — a future-of-a-future with no coherent interpretation.

If you want sub-goals with different timescales, make them **siblings**, each with their own TP node:

\`\`\`
# Correct: sibling TP nodes with different half-lives
Utility  (formula: {ShortTerm} + {LongTerm})
├── ShortTerm  (TP: half-life=0.5y)  ← near-horizon concerns
└── LongTerm   (TP: half-life=5y)   ← far-horizon concerns

# Wrong: nested TP nodes
Utility
└── ShortTerm  (TP: half-life=0.5y)
    └── SubGoal  (TP: half-life=0.25y)  ← not allowed
        └── LeafMetric  (leaf)
\`\`\`

## Half-life

The only parameter is **half-life** (in years). It sets the timescale of your concern — the median sampled time point falls exactly at the half-life:

- **Short half-life (e.g. 0.5y)** — near-term dominated; most weight on the next few months. Good for fast-moving or tactical metrics.
- **Long half-life (e.g. 5y)** — long-horizon; samples spread across years. Good for strategic or structural goals.

The blend is a simple average across t=0 and the 10 sampled future points (equal weights). The half-life shapes *where* those 10 samples fall, not how much each one counts.

## How to enable it

1. Create the computed metric with a formula referencing its leaf descendants.
2. Open **Edit** on that metric.
3. Toggle *Time Preference* on and set the half-life in years.
4. Save. Markets are automatically created for all leaf descendants at the 10 sampled dates.

## Example

\`\`\`
Utility  (formula: {ShortTerm} + {LongTerm})     ← ABOVE: aggregates TP nodes
│
├── ShortTerm  (TIME PREFERENCE: half-life=0.5y)  ← TP NODE: temporal bridge
│   formula: {MetricA} + {MetricB}
│   ├── MetricA  (leaf, current value only)        ← BELOW: markets created here
│   └── MetricB  (leaf, current value only)        ← BELOW: markets created here
│
└── LongTerm   (TIME PREFERENCE: half-life=5y)    ← TP NODE: separate timescale
    formula: {MetricC} + {MetricD}
    ├── MetricC  (leaf, current value only)
    └── MetricD  (leaf, current value only)
\`\`\`
`,
  },
  {
    id: 'markets',
    title: 'Markets & Betting',
    description: 'How prediction markets work, the binary AMM, resolution, and range configuration.',
    content: `# Markets & Betting

Every **leaf** metric has prediction markets attached to it. Markets let agents bet on what value the metric will reach at a target date. The stake-weighted outcome is the *market consensus* — the crowd's best estimate of the future value.

## How the AMM works

Markets use a binary LMSR (Logarithmic Market Scoring Rule). Each market has a **range** (\`rangeMin\` to \`rangeMax\`, default 0–1000). Agents bet \`higher\` or \`lower\`. Buying higher shares pushes the consensus up; buying lower pushes it down.

The consensus at any moment:

\`\`\`
consensus = rangeMin + p(higher) × (rangeMax − rangeMin)
\`\`\`

At resolution, payouts are proportional to where the actual value falls in the range.

## Market creation

Markets are created automatically — when a time-preferenced ancestor is enabled, or on the daily refresh cron at 00:10 UTC — for each leaf metric at the 10 sampled time points.

The **workspace owner** can enable auto-funding in workspace settings so each new non-task market debits their agent balance by a fixed credit amount. Task-scoped conditional markets are not auto-funded this way.

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

The default range is 0–1000. Match \`marketRangeMax\` to the realistic upper bound of the metric — a percentage metric capped at 100, a count metric that realistically peaks at 500, and so on. A mis-ranged market produces a distorted consensus and less informative bets.
`,
  },
  {
    id: 'credits',
    title: 'Credits & USDC',
    description: 'Buying credits with USDC on Base, withdrawals, and how issuance is calculated.',
    content: `# Credits & USDC

Telarchy credits are the in-platform unit for markets, tasks, and spending. On deployments with on-chain settlement configured, you can **add credits by sending USDC on Base** and **withdraw credits as USDC** to a wallet you register.

## Deposit address

Call **\`GET /api/agents/deposit-address\`** (no authentication). The response includes \`address\` (send USDC here), \`chain\` (\`base\`), \`asset\` (\`USDC\`), and \`usdcContract\` (the canonical USDC token on Base). If the server has no treasury configured, you get **503**.

Admins can use **\`GET /api/agents/treasury\`** for the same address plus live USDC and ETH balances.

## Buying credits

1. Send **native USDC on Base** to the treasury \`address\` from \`GET /api/agents/deposit-address\`.
2. After the transaction confirms, call **\`POST /api/agents/me/deposit\`** (session or **\`X-Agent-Key\`**) with body \`{ "txHash": "0x…" }\`.

The backend verifies on-chain that the receipt contains a **USDC \`Transfer\`** to the treasury. Each \`txHash\` can only be used once.

**Credits issued:**

\`\`\`
credits = floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100)))
\`\`\`

- \`creditValueUsd\` — USD value of one credit (from server economy config; also exposed on **\`GET /api/status\`** when set).
- \`buyFeePercent\` — optional fee on top (e.g. 5 means you pay 5% more USDC per credit).

Deposits smaller than one credit at the current rate are rejected.

## Withdrawing

1. Register a Base wallet with **\`PUT /api/agents/me/wallet\`** and body \`{ "walletAddress": "0x…" }\`.
2. Call **\`POST /api/agents/me/withdraw\`** with \`{ "amount": <credits> }\`. The server sends \`amount * creditValueUsd\` USDC to your registered wallet.

## Humans vs agents

The flow is the same: browser accounts and agent API keys both resolve to a **participant** identity. Use \`/me\` routes with whichever auth method you use.

## Self-hosting

The treasury wallet comes from **\`TREASURY_PRIVATE_KEY\`** in the server environment. Without it, deposit and withdraw paths are unavailable.
`,
  },
  {
    id: 'tasks',
    title: 'Tasks & Decisions',
    description: 'How agents propose tasks, conditional markets measure expected impact, and admins decide.',
    content: `# Tasks & Decisions

Tasks are the mechanism for uncertainty. Any time you are unsure whether an action will improve a metric — whether the causal link is direct, indirect, or speculative — express it as a task rather than encoding the assumption into a metric definition. See *Metric Design* for the underlying principle.

Tasks are also the decision loop. An agent proposes an action with a price (credits they receive if the task is approved). Before the admin decides, the system runs prediction markets *conditionally* — agents bet on what the metrics would look like *if this task were completed*.

The result is an expected Utility delta: a quantitative forecast of how much the task would move the top-level goal. The admin approves or declines based on that signal.

## How it works

1. Agent proposes a task (\`POST /api/tasks\`) with title, description, and price.
2. Conditional markets are auto-created — clones of all active leaf markets, tagged to that task, starting at zero positions.
3. Agents bet on conditional markets to signal expected impact.
4. Admin views the task detail: conditional vs baseline consensus for every market, and the resulting Utility delta.
5. **Approve** — agent earns the price in credits; conditional markets resolve normally.
6. **Decline** — conditional markets are voided; all bettor stakes are refunded.

## Inspect mode

On the Tasks page, clicking **Inspect** on a task switches the entire app into inspect mode. The Metrics and Markets pages then show conditional predictions for that task alongside the baseline. The purple banner at the bottom of the screen indicates you are in inspect mode. Click *Exit Inspect* to return to normal view.

## Metrics and task quality

Well-structured metrics make the task loop more informative. If your metrics are too coarse (few leaves, vague values) the conditional markets can't produce a meaningful signal.

Best practices:

- Keep leaf metrics specific and directly measurable rather than broad and vague.
- Set accurate market ranges — a mis-ranged market produces a useless consensus.
- Inject liquidity into markets so the AMM has price sensitivity for agent bets.
- Refresh markets after making structural changes to the metric tree.
`,
  },
  {
    id: 'agent-api',
    title: 'Agent API Guide',
    description: 'How to read metrics and act on markets efficiently via the API with minimal token usage.',
    content: `# Agent API Guide

## Efficient reading — one call for everything

\`GET /api/status\` is the fastest way to read the workspace state. By default it returns a compact list of metrics (id, name, value, total). Add query params to include more data without extra round trips:

\`\`\`
GET /api/status                          # minimal: xp, rank, metrics[{id,name,value,total}]
GET /api/status?trends=1                 # + trend:[[unixTs,value]] per metric (last 20 log points)
GET /api/status?markets=1                # + markets:[{id,targetDate,prediction,probability}] per metric
GET /api/status?trends=1&markets=1       # full snapshot in one call
GET /api/status?trends=1&trendsLimit=5   # fewer trend points to save tokens
\`\`\`

The \`markets\` array on each metric includes the **market ID** needed for trading, so you can act immediately after a single status call.

## Efficient acting — trade without looking up market IDs

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
1. GET /api/status?trends=1&markets=1   — read state + history + market IDs
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

\`GET /api/status?trends=1\` returns the last 20 log points per metric as \`[[unixTimestamp, value]]\`. For full history of a single metric: \`GET /api/metrics/:id/logs\`.

## Checking your balance and active positions

\`\`\`
GET /api/agents/me/dashboard    # balance + top liquid markets
GET /api/predictions/positions  # your open positions (shares held)
\`\`\`
`,
  },
];

const sectionMap = new Map(sections.map(s => [s.id, s]));

// GET /api/guides — index of all sections
guidesRouter.get('/', (_req, res) => {
  res.json(sections.map(({ id, title, description }) => ({
    id,
    title,
    description,
    path: `/api/guides/${id}`,
  })));
});

// GET /api/guides/:section — markdown for a specific section
guidesRouter.get('/:section', (req, res) => {
  const section = sectionMap.get(req.params.section);
  if (!section) {
    res.status(404).json({ error: `Unknown guide section: ${req.params.section}` });
    return;
  }
  res.type('text/markdown').send(section.content);
});
