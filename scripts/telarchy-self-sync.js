#!/usr/bin/env node
/**
 * Telarchy self-sync: push the dogfooding workspace's computed hero metrics.
 * Governed by docs/metrics.md (rebuilt 2026-08-14; the 2025-era four-metric
 * Firestore version died in the Postgres migration).
 *
 * Two metrics, both read from the public GET /api/marketplace/stats, which is
 * public on purpose: the resolution source has to be readable by the people
 * being asked to trust it, so the sync adds no computation of its own and
 * anyone can check either number.
 *
 * - "Weekly active verified traders" (`weeklyActiveVerifiedTraders`):
 *   distinct participants who (a) have a Manifold account synced and (b)
 *   placed trades totalling at least 100 credits (abs cost) in the trailing
 *   7 days, across all workspaces.
 * - "Telarchy revenue (USD)" (`revenue30dUsd`): money Telarchy itself was
 *   paid in the trailing 30 days. The owner's hand came off this one when
 *   the paid-liquidity rail went live (docs/metrics.md, "Revenue, trailing
 *   30 days"); a payment arriving on a rail the platform cannot see is added
 *   to that rail, not typed into the metric, or the next hourly run erases it.
 *
 * Hourly (2026-08-30, owner ask), so revenue is never more than an hour
 * stale on a floor that prices it on three horizons. A metric is written
 * only when its value actually changed: the metric log is public and a
 * trader audits it, so 24 identical rows a day would be noise, and market
 * resolution reads the last value at-or-before the boundary regardless of
 * how old it is.
 *
 * Auth: an agent key that is an admin member of the dogfooding workspace.
 * No master key: the sync only reads a public route and writes one metric,
 * so its blast radius is one workspace.
 *
 *   TELARCHY_SELF_SYNC_KEY        agent key (required)
 *   TELARCHY_SELF_SYNC_WORKSPACE  workspace id (required)
 *   TELARCHY_URL                  default https://telarchy.com
 *
 * Usage: node scripts/telarchy-self-sync.js [--dry-run]
 */

const TELARCHY_URL = process.env.TELARCHY_URL || 'https://telarchy.com';
const AGENT_KEY = process.env.TELARCHY_SELF_SYNC_KEY;
const WORKSPACE_ID = process.env.TELARCHY_SELF_SYNC_WORKSPACE;
// Every clock reads the same number (owner direction 2026-08-15): the
// horizons are the same definition read at different dates, so one value is
// pushed to each metric that carries it.
//
// Matched by name, which is a tripwire: renaming the metric in the app used to
// make this throw "no metric named ..." every night and the number would
// silently stop updating on a metric a prize market settles on. So the list is
// explicit and the rename goes in here at the same time (2026-08-19: the floor
// metric became "Active traders @1st October"; 2026-08-20: it became "Active
// traders (verified, 7-day)", because a date inside a metric's NAME is what
// made it a one-shot. A metric is a number over time and the market's target
// date carries the date, so "@1st October" bought exactly one market and left
// three orphaned weekly rows behind it every time the name moved. The floor
// shows the settle day after the name and computes it from the market, so the
// stored name never carries one again).
const METRIC_NAMES = [
  'Weekly active traders',
  'Active traders',
  'Active traders @1st October',
  'Weekly active verified traders',
];
// The revenue metric, matched the same way and for the same reason. The bare
// name plus a "(...)" tail is the whole list on purpose: a looser "Revenue"
// would also match a workspace's own revenue metric and overwrite it with
// Telarchy's number.
const REVENUE_METRIC_NAMES = ['Telarchy revenue'];
const AGENT_ID = 'telarchy-self-sync';
const STRATEGY = 'self-sync-v2';
const DRY_RUN = process.argv.includes('--dry-run');

async function api(method, pathname, body) {
  const res = await fetch(`${TELARCHY_URL}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': AGENT_KEY,
      'X-Workspace-Id': WORKSPACE_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Best-effort heartbeat to /admin. Never throws.
async function pushHeartbeat(payload) {
  try {
    await fetch(`${TELARCHY_URL}/api/admin/agent-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_KEY, 'X-Workspace-Id': WORKSPACE_ID },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn(`heartbeat push failed: ${e.message}`);
  }
}

function nextCycleAt() {
  const next = new Date();
  next.setUTCMinutes(40, 0, 0);
  if (next <= new Date()) next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

/** Metrics whose name is one of `names`, or one of them plus a "(...)" tail. */
function matchMetrics(list, names) {
  return list.filter(m => names.includes(m.name) || names.some(base => m.name.startsWith(`${base} (`)));
}

async function main() {
  if (!AGENT_KEY || !WORKSPACE_ID) {
    throw new Error('TELARCHY_SELF_SYNC_KEY and TELARCHY_SELF_SYNC_WORKSPACE are required');
  }
  const startedAt = new Date().toISOString();
  console.log(`telarchy-self-sync ${startedAt}${DRY_RUN ? ' (dry run)' : ''}`);
  if (!DRY_RUN)
    await pushHeartbeat({
      agentId: AGENT_ID,
      status: 'running',
      workspaceId: WORKSPACE_ID,
      strategy: STRATEGY,
      lastCycleStartedAt: startedAt,
    });

  // The values, from the public resolution source.
  const stats = await fetch(`${TELARCHY_URL}/api/marketplace/stats`).then(r => r.json());
  const value = stats.weeklyActiveVerifiedTraders;
  if (!Number.isFinite(value)) {
    throw new Error(
      `weeklyActiveVerifiedTraders missing from /api/marketplace/stats: ${JSON.stringify(stats).slice(0, 200)}`,
    );
  }
  // Warn rather than throw when the instance is older than this script (the
  // merge deploys the field and reschedules this run in the same commit, so
  // one hourly run can land against the previous build): the trader count is
  // the metric that must never silently stop, and failing the cycle over
  // revenue would stop it too.
  const revenue = stats.revenue30dUsd;
  if (!Number.isFinite(revenue)) {
    console.warn(
      `revenue30dUsd missing from /api/marketplace/stats, skipping revenue: ${JSON.stringify(stats).slice(0, 200)}`,
    );
  }

  const metricsList = await api('GET', '/metrics');
  const list = Array.isArray(metricsList) ? metricsList : metricsList.metrics || [];
  const targets = matchMetrics(list, METRIC_NAMES);
  if (targets.length === 0) {
    throw new Error(
      `no metric named any of ${METRIC_NAMES.map(n => `"${n}"`).join(', ')} in workspace ${WORKSPACE_ID}. ` +
        'If the metric was renamed in the app, add the new name here in the same change.',
    );
  }
  // The revenue metric may legitimately not exist yet in a workspace this
  // sync points at, so its absence is a warning, not a failed cycle: the
  // trader count is the one that must never silently stop.
  const revenueTargets = Number.isFinite(revenue) ? matchMetrics(list, REVENUE_METRIC_NAMES) : [];
  if (Number.isFinite(revenue) && revenueTargets.length === 0) {
    console.warn(`no metric named any of ${REVENUE_METRIC_NAMES.map(n => `"${n}"`).join(', ')}, skipping revenue`);
  }

  const pushes = [
    ...targets.map(metric => ({ metric, value, source: 'weeklyActiveVerifiedTraders' })),
    ...revenueTargets.map(metric => ({ metric, value: revenue, source: 'revenue30dUsd' })),
  ];

  let written = 0;
  let flat = 0;
  for (const { metric, value: next, source } of pushes) {
    // Only a changed number is written. The metric log is public and audited
    // by the traders pricing it, so an unchanged hourly reading would bury
    // the real ones; resolution reads the last value at-or-before the
    // boundary, so a gap between changes settles the same way.
    if (metric.value === next) {
      flat++;
      console.log(`  flat ${metric.name}: ${metric.value}`);
      continue;
    }
    console.log(`  PUSH ${metric.name}: ${metric.value} -> ${next}`);
    written++;
    if (!DRY_RUN) {
      await api('PUT', `/metrics/${metric.id}`, {
        name: metric.name,
        description: metric.description,
        value: next,
        formula: metric.formula || '0',
        oldValue: metric.value,
        updateNote: `hourly self-sync ${startedAt.slice(0, 16).replace('T', ' ')}Z (${source} from /api/marketplace/stats)`,
      });
    }
  }

  const endedAt = new Date().toISOString();
  console.log(`Done.`);
  if (!DRY_RUN) {
    await pushHeartbeat({
      agentId: AGENT_ID,
      status: 'idle',
      workspaceId: WORKSPACE_ID,
      strategy: STRATEGY,
      lastCycleStartedAt: startedAt,
      lastCycleEndedAt: endedAt,
      pollIntervalSeconds: 3600,
      nextCycleAt: nextCycleAt(),
      lastTraded: written,
      lastSkipped: flat,
      lastErrors: 0,
    });
  }
}

main().catch(async e => {
  console.error('FAILED:', e.message);
  if (AGENT_KEY && WORKSPACE_ID && !DRY_RUN) {
    await pushHeartbeat({
      agentId: AGENT_ID,
      status: 'error',
      workspaceId: WORKSPACE_ID,
      strategy: STRATEGY,
      lastCycleEndedAt: new Date().toISOString(),
      lastError: e.message.slice(0, 500),
    });
  }
  process.exit(1);
});
