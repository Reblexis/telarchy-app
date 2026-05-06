#!/usr/bin/env node
/**
 * Sync Telarchy's own self-monitoring metrics.
 *
 * Reads platform-wide data from telarchy.com /api, computes the 5 metrics
 * defined in docs/metrics.md, and PUTs each value into the Telarchy
 * dogfooding workspace ("Telarchy", id qzOIWWj7m6rDInxrvqPx).
 *
 * Each metric has a computeXxx() function that returns
 *   { value: number, note?: string } or
 *   { value: null, note: string } to skip with an explanation.
 *
 * Auth:
 *   TELARCHY_ADMIN_KEY  master API key (required for cross-workspace platform
 *                       reads — agent keys are scoped to their own workspace).
 *
 * Optional env:
 *   COHORT_WORKSPACE_IDS  comma-separated workspace IDs for the founder
 *                         concierge cohort (drives the Wedge metric).
 *
 * Usage:
 *   node scripts/telarchy-self-sync.js [--dry-run] [--metric "<name>"]
 *     --dry-run        compute, log, but do not PUT
 *     --metric NAME    sync only the named metric (repeatable)
 *     --threshold X    delta threshold (fraction of old value, default 0.005)
 */

const TELARCHY_URL = process.env.TELARCHY_URL || 'https://telarchy.com';
const ADMIN_KEY = process.env.TELARCHY_ADMIN_KEY;
const TELARCHY_WORKSPACE_ID = 'qzOIWWj7m6rDInxrvqPx';
const EXPECTED_WORKSPACE_NAME = 'Telarchy';

const COHORT_WORKSPACE_IDS = (process.env.COHORT_WORKSPACE_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NOW = Date.now();

// ---------------------------------------------------------------------
// API helper. Master key needs X-Workspace-Id; pass per-call so the same
// helper can hit any workspace.
// ---------------------------------------------------------------------

async function api(method, pathname, opts = {}) {
  const { workspaceId = TELARCHY_WORKSPACE_ID, body } = opts;
  const res = await fetch(`${TELARCHY_URL}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ADMIN_KEY,
      'X-Workspace-Id': workspaceId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} (ws=${workspaceId.slice(0, 8)}) -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Best-effort heartbeat. Never throws.
async function pushHeartbeat(payload) {
  try {
    await fetch(`${TELARCHY_URL}/api/admin/agent-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ADMIN_KEY,
        'X-Workspace-Id': TELARCHY_WORKSPACE_ID,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn(`heartbeat push failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------
// Per-metric computations.
// ---------------------------------------------------------------------

async function listAllWorkspaces() {
  return await api('GET', '/workspaces');
}

async function safeListProposals(workspaceId) {
  try {
    const res = await api('GET', '/proposals', { workspaceId });
    return Array.isArray(res) ? res : (res.proposals || []);
  } catch (e) {
    console.warn(`  proposals fetch failed for ws=${workspaceId.slice(0, 8)}: ${e.message}`);
    return [];
  }
}

async function safeListMarkets(workspaceId) {
  try {
    return await api('GET', '/predictions/markets', { workspaceId });
  } catch (e) {
    console.warn(`  markets fetch failed for ws=${workspaceId.slice(0, 8)}: ${e.message}`);
    return [];
  }
}

async function computeWedge() {
  if (COHORT_WORKSPACE_IDS.length === 0) {
    return { value: null, note: 'COHORT_WORKSPACE_IDS not set; cohort not yet recruited' };
  }
  let qualifying = 0;
  for (const wsId of COHORT_WORKSPACE_IDS) {
    let ws;
    try { ws = await api('GET', `/workspaces/${wsId}`, { workspaceId: wsId }); }
    catch (e) { console.warn(`  cohort ws ${wsId.slice(0, 8)}: ${e.message}`); continue; }
    const cutoff = new Date(ws.createdAt).getTime() + 4 * WEEK_MS;
    const markets = await safeListMarkets(wsId);
    const proposals = await safeListProposals(wsId);
    const earlyMarkets = markets.filter((m) => new Date(m.createdAt).getTime() <= cutoff).length;
    const earlyProposals = proposals.filter((p) => new Date(p.createdAt).getTime() <= cutoff).length;
    if (earlyMarkets >= 2 || earlyProposals >= 2) qualifying++;
  }
  const pct = (qualifying / COHORT_WORKSPACE_IDS.length) * 100;
  return {
    value: pct,
    note: `${qualifying}/${COHORT_WORKSPACE_IDS.length} cohort workspaces with >=2 priced decisions in 4w`,
  };
}

async function computeWAU() {
  const since = NOW - WEEK_MS;
  const workspaces = await listAllWorkspaces();
  let active = 0;
  for (const ws of workspaces) {
    const markets = await safeListMarkets(ws.id);
    if (markets.some((m) => new Date(m.createdAt).getTime() >= since)) { active++; continue; }
    const proposals = await safeListProposals(ws.id);
    if (proposals.some((p) => new Date(p.createdAt).getTime() >= since)) active++;
  }
  return { value: active, note: `${active}/${workspaces.length} workspaces with new market or proposal in last 7d` };
}

async function computeBrier() {
  const since = NOW - 30 * DAY_MS;
  const workspaces = await listAllWorkspaces();
  let weightedSum = 0;
  let totalWeight = 0;
  let count = 0;
  for (const ws of workspaces) {
    const markets = await safeListMarkets(ws.id);
    const resolved = markets.filter(
      (m) => m.status === 'resolved' && m.resolvedAt && new Date(m.resolvedAt).getTime() >= since,
    );
    for (const m of resolved) {
      let detail;
      try { detail = await api('GET', `/predictions/markets/${m.id}/context`, { workspaceId: ws.id }); }
      catch (e) { console.warn(`  market ${m.id.slice(0, 8)} context: ${e.message}`); continue; }
      const probAtClose = detail.market?.probability ?? detail.market?.consensusProbability;
      const finalValue = detail.market?.actualValue ?? m.actualValue ?? detail.metric?.currentValue;
      const rangeMin = m.rangeMin ?? detail.market?.rangeMin ?? 0;
      const rangeMax = m.rangeMax ?? detail.market?.rangeMax;
      if (probAtClose == null || finalValue == null || rangeMax == null) continue;
      const rangeMid = (rangeMin + rangeMax) / 2;
      const outcome = finalValue >= rangeMid ? 1 : 0;
      const brier = (probAtClose - outcome) ** 2;
      const liquidity = m.liquidity ?? detail.market?.liquidity ?? 1;
      weightedSum += brier * liquidity;
      totalWeight += liquidity;
      count++;
    }
  }
  if (count === 0) return { value: null, note: 'no resolved markets in last 30d' };
  return { value: weightedSum / totalWeight, note: `liquidity-weighted across ${count} resolved markets` };
}

async function computeActiveForecasters() {
  // Approximation v1: agents with positive realizedPnl across all workspaces.
  // realizedPnl is lifetime, not 30d-windowed. TODO: page through
  // /api/agents/:id/trades filtered by resolved markets in last 30d.
  const workspaces = await listAllWorkspaces();
  const positives = new Set();
  for (const ws of workspaces) {
    let agents;
    try { agents = await api('GET', '/agents', { workspaceId: ws.id }); }
    catch (e) { console.warn(`  agents fetch ws=${ws.id.slice(0, 8)}: ${e.message}`); continue; }
    for (const a of agents) {
      if ((a.realizedPnl ?? 0) > 0) positives.add(a.id);
    }
  }
  return {
    value: positives.size,
    note: `${positives.size} unique agents with lifetime realized PnL > 0 (TODO: window to 30d)`,
  };
}

async function computeProposalQuality() {
  // Stub: needs >=90d of approved agent-proposed proposals + per-metric value
  // history to correlate predicted vs realized lift. The data path:
  //   1. /api/proposals?status=approved across all workspaces.
  //   2. Filter to agent-proposers (proposerId is API-key participant).
  //   3. Filter to approvedAt + 90d <= now.
  //   4. For each, fetch per-metric conditional consensus at approval (cached
  //      via market context at the approval time) and per-metric value at
  //      approval and at approval+90d (via /api/metrics/:id/logs).
  //   5. Pearson correlation across (predicted, realized) pairs.
  // Implement when there is meaningful data — first agent-proposed proposal
  // approved >=90d ago is the trigger.
  return { value: null, note: 'stub: needs >=90d of approved agent-proposed proposals' };
}

const COMPUTE = {
  'Wedge: % cohort with >=2 priced decisions in 4w': computeWedge,
  'WAU: workspaces with >=1 priced decision (7d)': computeWAU,
  'Forecaster quality: liquidity-weighted Brier (30d)': computeBrier,
  'Active forecasters: agents with positive PnL (30d)': computeActiveForecasters,
  'Proposal quality: realized vs predicted lift (90d corr)': computeProposalQuality,
};

// ---------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, metrics: [], threshold: 0.005 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--metric') args.metrics.push(argv[++i]);
    else if (a === '--threshold') args.threshold = parseFloat(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/telarchy-self-sync.js [--dry-run] [--metric NAME] [--threshold 0.005]');
      process.exit(0);
    } else { console.error(`Unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

const AGENT_ID = 'telarchy-self-sync';
const STRATEGY = 'self-sync-v1';

function nextCycleAt() {
  const d = new Date();
  d.setUTCHours(3, 30, 0, 0);
  if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function main() {
  const args = parseArgs(process.argv);
  if (!ADMIN_KEY) {
    console.error('ERROR: set TELARCHY_ADMIN_KEY (master API key, required for cross-workspace reads)');
    process.exit(1);
  }

  const workspaces = await api('GET', '/workspaces');
  const ws = workspaces.find((w) => w.id === TELARCHY_WORKSPACE_ID);
  if (!ws || ws.name !== EXPECTED_WORKSPACE_NAME) {
    console.error(`ERROR: workspace ${TELARCHY_WORKSPACE_ID} is "${ws?.name || 'missing'}", expected "${EXPECTED_WORKSPACE_NAME}".`);
    process.exit(1);
  }

  const metrics = await api('GET', '/metrics');
  const byName = new Map(metrics.map((m) => [m.name, m]));

  const today = new Date().toISOString().slice(0, 10);
  console.log(`telarchy-self-sync ${today}  threshold=${args.threshold}  ${args.dryRun ? '(dry run)' : ''}`);
  console.log();

  const startedAt = new Date().toISOString();
  if (!args.dryRun) {
    await pushHeartbeat({
      agentId: AGENT_ID, status: 'running', workspaceId: TELARCHY_WORKSPACE_ID, strategy: STRATEGY,
      lastCycleStartedAt: startedAt, pollIntervalSeconds: 86400, nextCycleAt: nextCycleAt(),
    });
  }

  const targets = args.metrics.length ? args.metrics : Object.keys(COMPUTE);
  const counters = { traded: 0, skipped: 0, errors: 0 };

  for (const name of targets) {
    const metric = byName.get(name);
    const compute = COMPUTE[name];
    if (!metric) { console.log(`  SKIP ${name}: not in workspace`); counters.skipped++; continue; }
    if (!compute) { console.log(`  SKIP ${name}: no compute function`); counters.skipped++; continue; }

    let computed;
    try { computed = await compute(); }
    catch (e) { console.log(`  ERR  ${name}: ${e.message}`); counters.errors++; continue; }

    if (computed.value == null) {
      console.log(`  SKIP ${name}: ${computed.note || 'no value'}`);
      counters.skipped++;
      continue;
    }

    const oldVal = metric.value;
    const absDelta = Math.abs(computed.value - oldVal);
    const delta = oldVal === 0 ? (absDelta < 1e-9 ? 0 : Infinity) : absDelta / Math.abs(oldVal);
    const moved = delta >= args.threshold;
    const tag = moved ? 'PUSH' : 'flat';
    const noteSuffix = computed.note ? ` (${computed.note})` : '';
    console.log(`  ${tag} ${name}: ${oldVal} -> ${Number(computed.value).toFixed(4)}${noteSuffix}`);

    if (moved && !args.dryRun) {
      await api('PUT', `/metrics/${metric.id}`, {
        body: {
          name: metric.name,
          description: metric.description,
          value: computed.value,
          formula: metric.formula || '0',
          oldValue: oldVal,
          updateNote: `daily self-sync ${today}${computed.note ? ': ' + computed.note : ''}`,
        },
      });
      counters.traded++;
    } else if (!moved) {
      counters.skipped++;
    }
  }

  const endedAt = new Date().toISOString();
  console.log();
  console.log(`Done. ${counters.traded} pushed, ${counters.skipped} skipped, ${counters.errors} errors.`);

  if (!args.dryRun) {
    await pushHeartbeat({
      agentId: AGENT_ID, status: 'idle', workspaceId: TELARCHY_WORKSPACE_ID, strategy: STRATEGY,
      lastCycleStartedAt: startedAt, lastCycleEndedAt: endedAt,
      pollIntervalSeconds: 86400, nextCycleAt: nextCycleAt(),
      lastTraded: counters.traded, lastSkipped: counters.skipped, lastErrors: counters.errors,
    });
  }
}

main().catch(async (e) => {
  console.error('FAILED:', e.message);
  if (ADMIN_KEY) {
    await pushHeartbeat({
      agentId: AGENT_ID, status: 'error', workspaceId: TELARCHY_WORKSPACE_ID, strategy: STRATEGY,
      lastCycleEndedAt: new Date().toISOString(), lastError: e.message.slice(0, 500),
    });
  }
  process.exit(1);
});
