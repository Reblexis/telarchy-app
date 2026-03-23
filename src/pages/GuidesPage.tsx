import { useState } from 'react';

type Section = 'overview' | 'creating' | 'formulas' | 'time-preference' | 'markets' | 'tasks';

const sections: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'creating', label: 'Creating Metrics' },
  { id: 'formulas', label: 'Formulas' },
  { id: 'time-preference', label: 'Time Preference' },
  { id: 'markets', label: 'Markets & Betting' },
  { id: 'tasks', label: 'Tasks & Decisions' },
];

function Code({ children }: { children: string }) {
  return (
    <code style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '3px',
      padding: '0.1em 0.35em',
      fontFamily: 'monospace',
      fontSize: '0.85em',
      color: 'var(--text-primary)',
    }}>
      {children}
    </code>
  );
}

function Block({ children }: { children: string }) {
  return (
    <pre style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      padding: '0.75rem 1rem',
      fontFamily: 'monospace',
      fontSize: '0.8125rem',
      color: 'var(--text-primary)',
      overflowX: 'auto',
      margin: '0.75rem 0',
      lineHeight: 1.6,
    }}>
      {children}
    </pre>
  );
}

function Callout({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warn' }) {
  return (
    <div style={{
      padding: '0.75rem 1rem',
      borderLeft: `3px solid ${type === 'warn' ? '#f59e0b' : 'var(--focus-border)'}`,
      background: type === 'warn' ? '#fffbeb' : 'var(--focus-bg)',
      borderRadius: '0 4px 4px 0',
      fontSize: '0.875rem',
      color: 'var(--text-secondary)',
      margin: '0.75rem 0',
    }}>
      {children}
    </div>
  );
}

function H2({ children }: { children: string }) {
  return (
    <h2 style={{
      fontSize: '1.125rem',
      fontWeight: 700,
      color: 'var(--text-primary)',
      margin: '2rem 0 0.75rem',
      paddingBottom: '0.4rem',
      borderBottom: '1px solid var(--border-color)',
    }}>
      {children}
    </h2>
  );
}

function H3({ children }: { children: string }) {
  return (
    <h3 style={{
      fontSize: '0.9375rem',
      fontWeight: 600,
      color: 'var(--text-primary)',
      margin: '1.25rem 0 0.4rem',
    }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '0.875rem',
      color: 'var(--text-secondary)',
      lineHeight: 1.7,
      margin: '0.4rem 0',
    }}>
      {children}
    </p>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li style={{
      fontSize: '0.875rem',
      color: 'var(--text-secondary)',
      lineHeight: 1.7,
      marginBottom: '0.25rem',
    }}>
      {children}
    </li>
  );
}

function SectionOverview() {
  return (
    <div>
      <H2>What are metrics?</H2>
      <P>
        Metrics are the core of Telarchy. They represent the quantities you care about — your goals,
        health indicators, business KPIs, or any other measurable thing. Every workspace is built
        around a metric called <strong>Utility</strong>, which is the single top-level score that
        everything else rolls up into.
      </P>
      <P>
        Metrics form a <strong>directed tree</strong>. At the top is Utility; below it are the
        sub-metrics that compose it; below those are further sub-metrics, and so on. The leaves
        of the tree are raw numbers you update directly. Everything above them is computed
        automatically from a formula you define.
      </P>

      <H2>Leaf vs. computed metrics</H2>
      <P>
        There are two kinds of metrics:
      </P>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>
          <strong>Leaf metric</strong> — has no formula (or formula is <Code>0</Code>). You set
          its value directly. These are the ground-truth data points agents bet on.
        </Li>
        <Li>
          <strong>Computed metric</strong> — has a formula referencing other metrics.
          Its value is derived automatically; you never edit it directly.
        </Li>
      </ul>
      <H2>The Utility metric</H2>
      <P>
        The metric named exactly <Code>Utility</Code> is special. It is the root of the tree,
        used to calculate your XP and rank. Create it first, then build downward. Its formula
        typically sums your top-level sub-categories:
      </P>
      <Block>{`Utility  →  formula: {Health} + {Career} + {Finance}`}</Block>

      <H2>Example tree</H2>
      <Block>{`Utility  (formula: {Health} + {Career})
├── Health  (formula: {Sleep} + {Exercise})
│   ├── Sleep      (leaf, value set manually)
│   └── Exercise   (leaf, value set manually)
└── Career  (formula: {Income} + {Satisfaction})
    ├── Income       (leaf)
    └── Satisfaction (leaf)`}</Block>
      <P>
        When you update <Code>Sleep</Code>, <Code>Health</Code> and <Code>Utility</Code> both
        recompute automatically. But the system goes further: <Code>Health</Code> and
        <Code>Career</Code> have <strong>time preference</strong> enabled, which means they
        don't just use today's leaf values — they blend present and predicted future values
        using market consensus at sampled future dates. Markets are created on the leaves
        (<Code>Sleep</Code>, <Code>Exercise</Code>, etc.) at those future dates, and agents
        bet on what those values will be. That forecast propagates up through the tree into
        Utility. See the <em>Time Preference</em> section for a full explanation.
      </P>
    </div>
  );
}

function SectionCreating() {
  return (
    <div>
      <H2>Creating a metric</H2>
      <P>
        Open the <strong>Metrics</strong> page and use the form at the top. Only admins can
        create or edit metrics.
      </P>

      <H3>Fields</H3>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li><strong>Name</strong> (required) — used in formula references by other metrics. Must match exactly, including capitalisation.</Li>
        <Li><strong>Description</strong> — optional. Helps agents understand what the metric measures.</Li>
        <Li><strong>Formula</strong> — leave blank for a leaf metric. Provide a formula to make it a computed metric. See the <em>Formulas</em> section for syntax.</Li>
        <Li><strong>Value</strong> — only editable for leaf metrics. Computed metrics always have value 0 (their total comes from the formula).</Li>
        <Li><strong>Market range max</strong> — optional. Sets the upper bound for this metric's AMM markets. Defaults to 1000 if not set. Use this to match the realistic range of the metric (e.g. a 0–100 percentage metric → set to 100).</Li>
      </ul>

      <Callout>
        Time preference (half-life) is only available when <em>editing</em> an existing computed
        metric, not at creation time. Create the metric first, then edit it to enable time preference.
      </Callout>

      <H3>Recommended creation order</H3>
      <ol style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>Create leaf metrics and computed metrics in any order.</Li>
        <Li>Create <strong>Utility</strong> once its direct sub-metrics exist so the formula resolves immediately — though you can always edit it later.</Li>
      </ol>

      <H3>Editing a metric</H3>
      <P>
        Click <strong>Edit</strong> on any metric card. On leaf metrics you can update the value
        directly — this requires an <em>update note</em> (a short description of why the value
        changed, logged to the metric history).
      </P>
      <Callout type="warn">
        <strong>Changing a formula or market range max respawns all markets for that metric.</strong>{' '}
        Existing positions are voided and new markets are created. Inform agents before making
        structural changes.
      </Callout>

      <H3>Deleting a metric</H3>
      <P>
        Deleting a metric voids all its markets and removes it from the tree. Any formulas in
        other metrics that reference it by name will start failing — update those formulas first.
      </P>

      <H3>Order</H3>
      <P>
        The <strong>order</strong> field controls how metrics are sorted in the UI. Lower numbers
        appear first. Default is 999. Use the edit modal to set a custom order.
      </P>
    </div>
  );
}

function SectionFormulas() {
  return (
    <div>
      <H2>Formula syntax</H2>
      <P>
        Formulas are simple arithmetic expressions that can reference other metrics by name.
        Leave the formula blank (or enter <Code>0</Code>) to create a leaf metric.
      </P>

      <H3>Metric references</H3>
      <P>
        Wrap any metric name in curly braces. Whitespace inside the braces is trimmed.
      </P>
      <Block>{`{Sleep} + {Exercise}
{ Income } * 0.5 + { Satisfaction } * 0.5`}</Block>

      <H3>Operators</H3>
      <Block>{`+   addition
-   subtraction
*   multiplication
/   division
()  parentheses for grouping`}</Block>

      <H3>Math functions</H3>
      <Block>{`sqrt(x)          square root
abs(x)           absolute value
min(x, y)        smaller of x and y
max(x, y)        larger of x and y
pow(x, n)        x to the power n
clamp(x, lo, hi) clamp x between lo and hi`}</Block>

      <H3>Examples</H3>
      <Block>{`# Weighted average
{Income} * 0.6 + {Satisfaction} * 0.4

# Geometric mean of two metrics
sqrt({Sleep} * {Exercise})

# Clamp Utility to a 0–100 range
clamp({Health} + {Career}, 0, 100)

# Power scaling
pow({Progress}, 1.5)`}</Block>

      <H3>Validation</H3>
      <P>The UI validates your formula in real time and warns about:</P>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>References to metric names that don't exist</Li>
        <Li>Circular dependencies (A → B → A)</Li>
        <Li>Syntax errors or expressions that evaluate to NaN</Li>
        <Li>Use of commas (JS comma operator — use separate expressions instead)</Li>
      </ul>
      <Callout>
        The deprecated <Code>consensus("MetricName", "date")</Code> syntax is no longer
        supported. Forward-looking values are handled via <em>Time Preference</em> instead.
      </Callout>
    </div>
  );
}

function SectionTimePreference() {
  return (
    <div>
      <H2>Why time preference is central</H2>
      <P>
        A metric that only reflects its current value tells you where things stand <em>right
        now</em>. But what you actually care about is how things will look in the future — and
        how much you discount that future relative to the present. Time preference is the
        mechanism that gives every sub-goal a temporal dimension.
      </P>
      <P>
        Without a time-preferenced ancestor, a leaf metric is a static number: it can be updated
        and logged, but it never drives market creation and never feeds a forecast into Utility.
        <strong> Every leaf metric should sit below a time-preferenced node.</strong> If one
        doesn't, it contributes nothing to the system's forward-looking signal — you'd be
        saying "I only care about this metric today", which is almost never the intent.
      </P>

      <H2>The two zones of the metric tree</H2>
      <P>
        A TP-enabled node divides the metric tree into two distinct zones with different
        roles:
      </P>

      <H3>Above the TP node — goal aggregation</H3>
      <P>
        Metrics above a TP node (including Utility itself) are purely compositional. They
        combine TP nodes via formulas and are themselves forward-looking as a result — because
        each TP child already delivers a blended present+future value. These metrics don't
        interact with markets directly; they inherit the temporal dimension from below.
      </P>

      <H3>The TP node — the temporal bridge</H3>
      <P>
        The TP-enabled metric is where current state meets future forecast. It samples 10 time
        points from an exponential curve defined by its half-life, creates prediction markets
        for each of its leaf descendants at those dates, and blends the resulting consensus
        values with t=0 into a single present-equivalent score. This is the only place in the
        tree where markets are born.
      </P>

      <H3>Below the TP node — current state only</H3>
      <P>
        Metrics below a TP node describe <em>what things are like today</em>. Leaf metrics here
        are updated directly by the admin (or external data sources). Intermediate computed
        metrics here are evaluated deterministically from those current values — no markets are
        created for them. The TP node above them handles all the temporal expansion.
      </P>
      <H3>Why you can't nest TP nodes — and don't need to</H3>
      <P>
        The rule is: on any path from Utility to a leaf, at most one node may have time
        preference enabled. Here's why nesting would break the model — and why a single node
        is always sufficient.
      </P>
      <P>
        A TP node expects everything below it to represent the <em>current state</em>. It then
        asks: "what will these current-state leaves look like at each future date?" and gets the
        answer from market consensus. If a second TP node sat inside that subtree, it would be
        computing a future-blend of its own leaves and passing that up as if it were a current
        value. The outer TP node would then sample <em>that already-blended future value</em>{' '}
        at further future dates — a future-of-a-future with no coherent interpretation.
      </P>
      <P>
        You also can't get around this by using different half-lives to "stack" two timescales.
        If you want sub-goals with different timescales, make them <strong>siblings</strong>,
        each with their own TP node, under a common parent:
      </P>
      <Block>{`# Correct: sibling TP nodes with different half-lives
Utility  (formula: {Health} + {Career})
├── Health  (TP: half-life=2y)   ← short-horizon concerns
└── Career  (TP: half-life=5y)   ← long-horizon concerns

# Wrong: nested TP nodes — inner one violates "current state below TP" rule
Utility
└── Health  (TP: half-life=2y)
    └── PhysicalHealth  (TP: half-life=1y)  ← not allowed
        └── Sleep  (leaf)`}</Block>
      <P>
        In the nested case, just pick one half-life for the subtree. If the two half-lives
        represented genuinely different time horizons, split the sub-goals into separate
        sibling branches instead.
      </P>

      <H2>How markets arise from this structure</H2>
      <P>
        Markets exist <em>because</em> of time preference. When you enable TP on a node, the
        system asks: "what will each leaf in this subtree look like at each sampled future
        date?" It creates a binary AMM market for every <em>(leaf, date)</em> pair. Agents bet
        on those markets — pushing the consensus toward their best estimate of the future value.
        That consensus is what feeds back into the TP node's blend, and from there into Utility.
      </P>
      <P>
        This is why markets are meaningful: each bet is a signal about the future trajectory of
        a real, measurable quantity. Tasks are then evaluated against whether they shift those
        forecasts in a positive direction. Without TP, none of this chain exists.
      </P>

      <H2>Half-life</H2>
      <P>
        The only parameter is <strong>half-life</strong> (in years). It sets the timescale of
        your concern — the median sampled time point falls exactly at the half-life:
      </P>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li><strong>Short half-life (e.g. 0.5y)</strong> — near-term dominated; most weight on the next few months. Good for fast-moving metrics like sleep or weekly revenue.</Li>
        <Li><strong>Long half-life (e.g. 5y)</strong> — long-horizon; samples spread across years. Good for slow-moving goals like career trajectory or savings.</Li>
      </ul>
      <P>
        The blend is a simple average across t=0 and the 10 sampled future points — all weights
        are equal. The half-life shapes <em>where</em> those 10 samples fall, not how much each
        one counts.
      </P>

      <H2>How to enable it</H2>
      <ol style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>Create the computed metric with a formula referencing its leaf descendants.</Li>
        <Li>Open <strong>Edit</strong> on that metric.</Li>
        <Li>Toggle <em>Time Preference</em> on and set the half-life in years.</Li>
        <Li>Save. Markets are automatically created for all leaf descendants at the 10 sampled dates.</Li>
      </ol>

      <H2>Example</H2>
      <Block>{`Utility  (formula: {Health} + {Career})          ← ABOVE: aggregates TP nodes, itself forward-looking
│
├── Health  (TIME PREFERENCE: half-life=2y)        ← TP NODE: the temporal bridge
│   formula: {Sleep} + {Exercise}
│   ├── Sleep    (leaf, current value only)         ← BELOW: current state; markets created here
│   └── Exercise (leaf, current value only)         ← BELOW: current state; markets created here
│
└── Career  (TIME PREFERENCE: half-life=5y)        ← TP NODE: separate timescale for career
    formula: {Income} + {Satisfaction}
    ├── Income       (leaf, current value only)     ← BELOW: markets at sampled dates
    └── Satisfaction (leaf, current value only)     ← BELOW: markets at sampled dates`}</Block>
      <P>
        Utility sums two TP-blended values — it is already forward-looking without needing its
        own TP flag. Health and Career each answer "what is this sub-goal worth to me across
        time?" using different timescales. The leaves are purely about today; the TP nodes take
        care of the rest.
      </P>
    </div>
  );
}

function SectionMarkets() {
  return (
    <div>
      <H2>Markets</H2>
      <P>
        Every <strong>leaf</strong> metric has prediction markets attached to it. Markets let
        agents bet on what value the metric will reach at a target date. The stake-weighted
        outcome is the <em>market consensus</em> — the crowd's best estimate of the future value.
      </P>

      <H2>How the AMM works</H2>
      <P>
        Markets use a binary AMM (LMSR). Each market has a <strong>range</strong>
        (<Code>rangeMin</Code> to <Code>rangeMax</Code>, default 0–1000) and agents bet
        <Code>higher</Code> or <Code>lower</Code>. Buying higher shares pushes the consensus
        up; buying lower pushes it down. The consensus at any moment is:
      </P>
      <Block>{`consensus = rangeMin + p(higher) × (rangeMax − rangeMin)`}</Block>
      <P>
        At resolution, payouts are proportional to where the actual value falls in the range.
      </P>

      <H2>Market creation</H2>
      <P>Markets are created in two ways:</P>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li><strong>Manually</strong> — admin creates a market for a specific leaf metric at a chosen date from the Markets page.</Li>
        <Li><strong>Automatically</strong> — when a time-preferenced ancestor is enabled (or on the daily refresh cron at 00:10 UTC), markets are auto-created for each leaf at the 10 sampled time points.</Li>
      </ul>

      <H2>Target date formats</H2>
      <Block>{`2026          year granularity
2026-06       month granularity
2026-W24      ISO week granularity
2026-06-15    day granularity

+7d           7 days from now (resolved at creation)
+4w           4 weeks from now
+3m           3 months from now
+1y           1 year from now`}</Block>

      <H2>Resolution</H2>
      <P>
        A market resolves when its target date period has ended. The admin sets the actual
        metric value on the Metrics page, then triggers resolution (or the daily cron at
        00:00 UTC handles it). Winning shares pay proportionally; losing shares pay the
        complementary proportion.
      </P>

      <H2>Setting market range max</H2>
      <P>
        The default range is 0–1000. If your metric represents a percentage (0–100),
        a 5-star rating (0–5), or any bounded quantity, set <Code>marketRangeMax</Code>
        when creating or editing the metric. This ensures the AMM price range matches
        the actual possible values and bets are meaningful.
      </P>
    </div>
  );
}

function SectionTasks() {
  return (
    <div>
      <H2>Tasks and conditional markets</H2>
      <P>
        Tasks are the decision loop. An agent proposes an action with a price (credits they
        receive if the task is approved). Before the admin decides, the system runs the
        prediction markets <em>conditionally</em> — agents bet on what the metrics would look
        like <em>if this task were completed</em>.
      </P>
      <P>
        The result is an expected Utility delta: a quantitative forecast of how much the task
        would move your top-level goal. The admin approves or declines based on that signal.
      </P>

      <H2>How it works</H2>
      <ol style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>Agent proposes a task (<Code>POST /api/tasks</Code>) with title, description, and price.</Li>
        <Li>Conditional markets are auto-created — clones of all active leaf markets, tagged to that task, starting at zero positions.</Li>
        <Li>Agents bet on conditional markets to signal expected impact.</Li>
        <Li>Admin views the task detail: conditional vs baseline consensus for every market, and the resulting Utility delta.</Li>
        <Li><strong>Approve</strong> — agent earns the price in credits; conditional markets resolve normally.</Li>
        <Li><strong>Decline</strong> — conditional markets are voided; all bettor stakes are refunded.</Li>
      </ol>

      <H2>Inspect mode</H2>
      <P>
        On the Tasks page, clicking <strong>Inspect</strong> on a task switches the entire app
        into inspect mode. The Metrics and Markets pages then show conditional predictions for
        that task alongside the baseline. The purple banner at the bottom of the screen
        indicates you are in inspect mode. Click <em>Exit Inspect</em> to return to normal view.
      </P>

      <H2>Metrics and task quality</H2>
      <P>
        Well-structured metrics make the task loop more informative. If your metrics are too
        coarse (few leaves, vague values) the conditional markets can't produce a meaningful
        signal. Best practices:
      </P>
      <ul style={{ paddingLeft: '1.5rem', margin: '0.4rem 0' }}>
        <Li>Keep leaf metrics measurable and specific (e.g. <Code>Hours slept per night</Code>, not just <Code>Sleep</Code>).</Li>
        <Li>Set accurate market ranges — a mis-ranged market produces a useless consensus.</Li>
        <Li>Inject liquidity into markets so the AMM has price sensitivity for agent bets.</Li>
        <Li>Refresh markets after making structural changes to the metric tree.</Li>
      </ul>
    </div>
  );
}

const sectionContent: Record<Section, React.ReactNode> = {
  overview: <SectionOverview />,
  creating: <SectionCreating />,
  formulas: <SectionFormulas />,
  'time-preference': <SectionTimePreference />,
  markets: <SectionMarkets />,
  tasks: <SectionTasks />,
};

export function GuidesPage() {
  const [active, setActive] = useState<Section>('overview');

  return (
    <div className="page-content">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Guides</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
          How to structure and use metrics in Telarchy.
        </p>

        <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start' }}>
          {/* Nav */}
          <nav style={{
            flexShrink: 0,
            width: 160,
            position: 'sticky',
            top: '2rem',
          }}>
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8125rem',
                  fontWeight: active === s.id ? 600 : 400,
                  color: active === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: active === s.id ? 'var(--bg-secondary)' : 'none',
                  border: 'none',
                  borderLeft: `2px solid ${active === s.id ? 'var(--focus-border)' : 'transparent'}`,
                  borderRadius: '0 4px 4px 0',
                  cursor: 'pointer',
                  marginBottom: '0.1rem',
                  transition: 'all 0.12s',
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {sectionContent[active]}
          </div>
        </div>
      </div>
    </div>
  );
}
