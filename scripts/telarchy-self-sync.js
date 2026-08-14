#!/usr/bin/env node
/**
 * Telarchy self-sync: push the dogfooding workspace's one hero metric.
 * Governed by docs/infra/self-sync.md (rebuilt 2026-08-14; the 2025-era
 * four-metric Firestore version died in the Postgres migration).
 *
 * The metric is "Weekly active participants": distinct participants, human
 * or AI, with a trade or a proposal in the trailing 7 days, across all
 * workspaces. The value is read from GET /api/marketplace/stats
 * (weeklyActiveParticipants), which is public on purpose: the resolution
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
const METRIC_NAME = 'Weekly active participants';
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
  if (!DRY_RUN) await pushHeartbeat({ agentId: AGENT_ID, status: 'running', workspaceId: WORKSPACE_ID, strategy: STRATEGY, lastCycleStartedAt: startedAt });

  // The value, from the public resolution source.
  const stats = await fetch(`${TELARCHY_URL}/api/marketplace/stats`).then(r => r.json());
  const value = stats.weeklyActiveParticipants;
  if (!Number.isFinite(value)) {
    throw new Error(`weeklyActiveParticipants missing from /api/marketplace/stats: ${JSON.stringify(stats).slice(0, 200)}`);
  }

  const metricsList = await api('GET', '/metrics');
  const list = Array.isArray(metricsList) ? metricsList : (metricsList.metrics || []);
  const metric = list.find(m => m.name === METRIC_NAME);
  if (!metric) throw new Error(`metric "${METRIC_NAME}" not found in workspace ${WORKSPACE_ID}`);

  const tag = metric.value === value ? 'flat' : 'PUSH';
  console.log(`  ${tag} ${METRIC_NAME}: ${metric.value} -> ${value}`);
  if (!DRY_RUN) {
    await api('PUT', `/metrics/${metric.id}`, {
      name: metric.name,
      description: metric.description,
      value,
      formula: metric.formula || '0',
      oldValue: metric.value,
      updateNote: `daily self-sync ${startedAt.slice(0, 10)} (weeklyActiveParticipants from /api/marketplace/stats)`,
    });
  }

  const endedAt = new Date().toISOString();
  console.log(`Done.`);
  if (!DRY_RUN) {
    await pushHeartbeat({
      agentId: AGENT_ID, status: 'idle', workspaceId: WORKSPACE_ID, strategy: STRATEGY,
      lastCycleStartedAt: startedAt, lastCycleEndedAt: endedAt,
      pollIntervalSeconds: 86400, nextCycleAt: nextCycleAt(),
      lastTraded: 1, lastSkipped: 0, lastErrors: 0,
    });
  }
}

main().catch(async (e) => {
  console.error('FAILED:', e.message);
  if (AGENT_KEY && WORKSPACE_ID && !DRY_RUN) {
    await pushHeartbeat({
      agentId: AGENT_ID, status: 'error', workspaceId: WORKSPACE_ID, strategy: STRATEGY,
      lastCycleEndedAt: new Date().toISOString(), lastError: e.message.slice(0, 500),
    });
  }
  process.exit(1);
});
