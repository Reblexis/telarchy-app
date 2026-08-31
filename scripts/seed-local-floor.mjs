#!/usr/bin/env node
/**
 * Seed a local mirror of the LookPilot trading floor, so the public trade
 * page can be iterated on at http://localhost:5173/lookpilot with Vite hot
 * reload instead of a ~8 minute Cloud Run deploy per look.
 *
 * Idempotent: if /api/marketplace/lookpilot already resolves, it reports and
 * exits. Everything it creates is local-only (the dev Postgres); it never
 * touches production.
 *
 * Usage: node scripts/seed-local-floor.mjs   (dev servers must be running)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.LOCAL_API ?? 'http://localhost:8080';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = readFileSync(join(root, '.env'), 'utf8');
const MASTER = envFile.match(/^API_KEY=(.+)$/m)?.[1]?.trim();
if (!MASTER) {
  console.error('.env has no API_KEY');
  process.exit(1);
}

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

const asAdmin = wsId => ({ 'X-API-Key': MASTER, ...(wsId ? { 'X-Workspace-Id': wsId } : {}) });

// Resume-safe: every step checks what already exists, so a partial earlier
// run (or a re-run after schema changes) completes instead of bailing.
const existing = await fetch(`${API}/api/marketplace/lookpilot`);
let wsId;
if (existing.ok) {
  const pub = await existing.json();
  wsId = pub.workspaceId;
  if ((pub.markets ?? []).length > 0 && (pub.proposals ?? []).length > 0) {
    console.log('Local floor already seeded: http://localhost:5173/lookpilot');
    process.exit(0);
  }
  console.log(`Resuming half-seeded workspace ${wsId}…`);
} else {
  console.log('Creating workspace…');
  // The auth middleware wants a workspace context even on create when the
  // caller is the master key; any existing workspace satisfies it.
  const anyWs = await call('/api/marketplace/workspaces/public');
  const contextWs = anyWs[0]?.workspaceId ?? 'default';
  const ws = await call('/api/workspaces', {
    method: 'POST',
    headers: asAdmin(contextWs),
    body: { name: 'LookPilot', visibility: 'public' },
  });
  wsId = ws.id ?? ws.workspaceId;
  console.log(`  workspace ${wsId} (slug ${ws.slug})`);
}

console.log('Creating the hero metric…');
const metricsNow = await call('/api/metrics', { headers: asAdmin(wsId) });
const metricList = Array.isArray(metricsNow) ? metricsNow : (metricsNow.metrics ?? []);
if (!metricList.some(m => m.name === 'LookPilot net 2026 (USD)')) {
  await call('/api/metrics', {
    method: 'POST',
    headers: asAdmin(wsId),
    body: {
      name: 'LookPilot net 2026 (USD)',
      description: 'Local mirror of the production hero metric. Fake value.',
      value: 44439,
      marketRangeMax: 500_000,
      timePreference: { enabled: true, halfLife: 1, customHorizons: ['2026-12'] },
    },
  });
} else {
  console.log('  metric exists, skipping');
}
await call('/api/predictions/markets/refresh', {
  method: 'POST',
  headers: asAdmin(wsId),
  body: {},
});

console.log('Registering a local market maker…');
// The key is persisted next to the script (gitignored), so resumes reuse the
// same maker; a lost keyfile just mints a fresh maker with a new suffix.
const keyFile = join(root, 'scripts/.local-floor-maker.json');
let makerId, makerKey;
if (existsSync(keyFile)) {
  ({ makerId, makerKey } = JSON.parse(readFileSync(keyFile, 'utf8')));
  console.log(`  reusing ${makerId}`);
} else {
  makerId = `local-maker-${Math.random().toString(36).slice(2, 7)}`;
  const maker = await call('/api/agents/register', {
    method: 'POST',
    body: { agentId: makerId, workspaceId: wsId, nickname: makerId, bio: 'Seed liquidity for the local dev floor.' },
  });
  makerKey = maker.apiKey;
  writeFileSync(keyFile, JSON.stringify({ makerId, makerKey }));
}
await call(`/api/agents/${makerId}/credit`, {
  method: 'POST',
  headers: asAdmin(wsId),
  body: { amount: 5000, reason: 'local dev seed' },
});
const asMaker = { 'X-Agent-Key': makerKey, 'X-Workspace-Id': wsId };

// The production floor is an Open workspace: its Public group grants trade,
// which is what makes the page's silent-join-as-trader work. Mirror that.
console.log('Opening the floor (Public group trades)…');
const groups = await call('/api/groups', { headers: asAdmin(wsId) });
const groupList = Array.isArray(groups) ? groups : (groups.groups ?? []);
const publicGroup = groupList.find(g => g.type === 'public');
if (publicGroup && !(publicGroup.capabilities ?? []).includes('trade')) {
  await call(`/api/groups/${publicGroup.id}`, {
    method: 'PUT',
    headers: asAdmin(wsId),
    body: { capabilities: ['read', 'trade'] },
  });
}

const markets = await call('/api/predictions/markets', { headers: asAdmin(wsId) });
const hero = markets.find(m => !m.proposalId);
if (!hero) throw new Error('no hero market after refresh');
console.log(`  hero market ${hero.id}`);

if (hero.liquidity < 100) {
  await call(`/api/predictions/markets/${hero.id}/liquidity`, {
    method: 'POST',
    headers: asAdmin(wsId),
    body: { amount: 400, agentId: makerId },
  });
}

console.log('Seeding price history…');
// A few steps so the chart has a line, ending at the production-like call.
// The opening price is the operator's statement, and nothing limits its size.
for (const target of [90_000, 81_000, 73_600]) {
  await call('/api/predictions/trade', {
    method: 'POST',
    headers: asMaker,
    body: { marketId: hero.id, targetValue: target, maxBudget: 400 },
  });
}

console.log('Creating a sample job (with branch markets)…');
await call('/api/proposals', {
  method: 'POST',
  headers: asMaker,
  body: {
    title: '$10: buy a copy',
    description: 'Local sample job so the branch toggle and conditional charts render.',
    liquiditySubsidy: 20,
    askUsd: 10,
  },
});

console.log(`
Done. Open http://localhost:5173/lookpilot
Sign in with any local account (or the admin account from keyring/telarchy/admin.env);
signup credits apply automatically. Edits under src/ hot-reload instantly.`);
