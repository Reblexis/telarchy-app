#!/usr/bin/env node
/**
 * Telarchy self-sync: push the dogfooding workspace's one hero metric.
 * Governed by docs/infra/self-sync.md (rebuilt 2026-08-14; the 2025-era
 * four-metric Firestore version died in the Postgres migration).
 *
 * The metric is "Weekly active verified traders": distinct participants who
 * (a) have a Manifold account synced and (b) placed trades totalling at
 * least 100 credits (abs cost) in the trailing 7 days, across all
 * workspaces. The value is read from GET /api/marketplace/stats
 * (weeklyActiveVerifiedTraders), which is public on purpose: the resolution
 * source has to be readable by the people being asked to trust it, so the
 * sync adds no computation of its own and anyone can check the number.
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
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(23, 40, 0, 0);
  return next.toISOString();
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

  // The value, from the public resolution source.
  const stats = await fetch(`${TELARCHY_URL}/api/marketplace/stats`).then(r => r.json());
  const value = stats.weeklyActiveVerifiedTraders;
  if (!Number.isFinite(value)) {
    throw new Error(
      `weeklyActiveVerifiedTraders missing from /api/marketplace/stats: ${JSON.stringify(stats).slice(0, 200)}`,
    );
  }

  const metricsList = await api('GET', '/metrics');
  const list = Array.isArray(metricsList) ? metricsList : metricsList.metrics || [];
  const targets = list.filter(
    m => METRIC_NAMES.includes(m.name) || METRIC_NAMES.some(base => m.name.startsWith(`${base} (`)),
  );
  if (targets.length === 0) {
    throw new Error(
      `no metric named any of ${METRIC_NAMES.map(n => `"${n}"`).join(', ')} in workspace ${WORKSPACE_ID}. ` +
        'If the metric was renamed in the app, add the new name here in the same change.',
    );
  }

  for (const metric of targets) {
    const tag = metric.value === value ? 'flat' : 'PUSH';
    console.log(`  ${tag} ${metric.name}: ${metric.value} -> ${value}`);
    if (!DRY_RUN) {
      await api('PUT', `/metrics/${metric.id}`, {
        name: metric.name,
        description: metric.description,
        value,
        formula: metric.formula || '0',
        oldValue: metric.value,
        updateNote: `daily self-sync ${startedAt.slice(0, 10)} (weeklyActiveVerifiedTraders from /api/marketplace/stats)`,
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
      pollIntervalSeconds: 86400,
      nextCycleAt: nextCycleAt(),
      lastTraded: targets.length,
      lastSkipped: 0,
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
