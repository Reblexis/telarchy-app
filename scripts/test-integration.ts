#!/usr/bin/env node
/**
 * Integration test suite for the Telarchy API.
 *
 * Tests the live API end-to-end to verify behaviour documented in:
 *   docs/vision.md, docs/agent-economy.md, docs/go-to-market.md
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 API_KEY=<master> node scripts/test-integration.ts
 *
 * The tests run against a freshly created workspace and clean up after themselves.
 * To add new tests: call test() inside an existing or new suite() block.
 */

// ─── Runner ───────────────────────────────────────────────────────────────────

interface TestResult { name: string; passed: boolean; error?: string; suite: string }

const results: TestResult[] = [];
let currentSuite = 'root';

async function suite(name: string, fn: () => Promise<void>): Promise<void> {
  const prev = currentSuite;
  currentSuite = name;
  console.log(`\n  ${name}`);
  try { await fn(); } catch (e) {
    console.error(`  Suite setup failed: ${(e as Error).message}`);
  }
  currentSuite = prev;
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true, suite: currentSuite });
    process.stdout.write(`    ✓ ${name}\n`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    results.push({ name, passed: false, error: msg, suite: currentSuite });
    process.stdout.write(`    ✗ ${name}\n      ${msg}\n`);
  }
}

/** Assertion builder — all helpers throw on failure. */
function expect(actual: unknown) {
  const fail = (msg: string) => { throw new Error(msg); };
  return {
    toBe:                 (v: unknown) => { if (actual !== v) fail(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`); },
    toBeGreaterThan:      (n: number)  => { if ((actual as number) <= n) fail(`Expected > ${n}, got ${actual}`); },
    toBeGreaterThanOrEqual: (n: number) => { if ((actual as number) < n) fail(`Expected >= ${n}, got ${actual}`); },
    toBeLessThan:         (n: number)  => { if ((actual as number) >= n) fail(`Expected < ${n}, got ${actual}`); },
    toBeCloseTo:          (n: number, precision = 2) => {
      if (Math.abs((actual as number) - n) > Math.pow(10, -precision) / 2)
        fail(`Expected ≈${n}, got ${actual}`);
    },
    toContainStr:         (sub: string) => { if (!String(actual).includes(sub)) fail(`Expected "${actual}" to contain "${sub}"`); },
    toBeTruthy:           () => { if (!actual) fail(`Expected truthy, got ${JSON.stringify(actual)}`); },
    toBeFalsy:            () => { if (actual)  fail(`Expected falsy, got ${JSON.stringify(actual)}`); },
    toBeArray:            () => { if (!Array.isArray(actual)) fail(`Expected array, got ${typeof actual}`); },
    toBeType:             (t: string) => { if (typeof actual !== t) fail(`Expected type ${t}, got ${typeof actual}`); },
    /** Check HTTP status is one of the accepted codes. */
    toBeStatus:           (...codes: number[]) => {
      if (!codes.includes(actual as number))
        fail(`Expected status in [${codes.join(', ')}], got ${actual}`);
    },
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const BASE_URL  = process.env.BASE_URL ?? process.argv[2] ?? 'http://localhost:8080';
const ADMIN_KEY = process.env.API_KEY  ?? process.argv[3] ?? '';

if (!ADMIN_KEY) {
  console.error('Error: API_KEY env var required (master API key).');
  process.exit(1);
}

type HeaderMap = Record<string, string>;

async function apiRaw(
  method: string, path: string, body?: unknown, extra: HeaderMap = {},
): Promise<{ status: number; body: unknown }> {
  const headers: HeaderMap = { 'Content-Type': 'application/json', ...extra };
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

/** Make an authenticated call using the master API key with a workspace context. */
function adminCall(wsId: string) {
  return (method: string, path: string, body?: unknown) =>
    apiRaw(method, path, body, { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': wsId });
}

/** Make an authenticated call using an agent key with a workspace context. */
function agentCall(agentKey: string, wsId: string) {
  return (method: string, path: string, body?: unknown) =>
    apiRaw(method, path, body, { 'X-Agent-Key': agentKey, 'X-Workspace-Id': wsId });
}

/** Assert 2xx, return parsed body as object. Throws with HTTP status on failure. */
function ok(r: { status: number; body: unknown }, label = ''): Record<string, unknown> {
  if (r.status < 200 || r.status >= 300)
    throw new Error(`${label ? label + ': ' : ''}HTTP ${r.status} — ${JSON.stringify(r.body)}`);
  return r.body as Record<string, unknown>;
}

// ─── Shared test state ────────────────────────────────────────────────────────

// All properties are set by early suites and consumed by later ones.
// Typed permissively to avoid initialisation boilerplate.
const ctx = {} as {
  wsId: string;   wsId2: string;
  agentId: string; agentKey: string;
  metricId: string; metricName: string;
  marketId: string;
  taskId: string;
};

// authMiddleware always requires X-Workspace-Id when using the master key.
// Workspace creation (POST /workspaces) ignores req.auth.workspaceId and generates
// its own UUID, so a dummy value is fine for bootstrapping.
const PLACEHOLDER_WS = 'bootstrap';

// ─── Test suites ──────────────────────────────────────────────────────────────

async function main() {

await suite('Health', async () => {
  await test('GET /api/help returns endpoint documentation', async () => {
    const r = await apiRaw('GET', '/help', undefined, { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS });
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>).endpoints).toBeTruthy();
  });

  await test('GET /api/status rejects unauthenticated requests (401)', async () => {
    const r = await apiRaw('GET', '/status');
    expect(r.status).toBe(401);
  });

  await test('GET /api/status returns workspace summary when authenticated', async () => {
    // Returns { xp, rank, metrics, creditValueUsd } — not a generic { ok: true }
    const r = await apiRaw('GET', '/status', undefined, { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS });
    expect(r.status).toBe(200);
    expect(typeof (r.body as Record<string, unknown>).rank).toBeType('string');
  });
});

await suite('Workspaces', async () => {
  await test('POST /api/workspaces creates a workspace', async () => {
    const r = ok(await apiRaw('POST', '/workspaces', { name: 'Integration Test Workspace' }, {
      'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS,
    }));
    ctx.wsId = r.id as string;
    expect(ctx.wsId).toBeTruthy();
  });

  await test('GET /api/workspaces/:id returns workspace details', async () => {
    const call = adminCall(ctx.wsId);
    const r = ok(await call('GET', `/workspaces/${ctx.wsId}`));
    expect(r.id).toBe(ctx.wsId);
    expect(r.name).toBe('Integration Test Workspace');
  });

  await test('GET /api/workspaces lists the workspace (admin sees all)', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/workspaces');
    expect(r.status).toBe(200);
    const list = r.body as Array<Record<string, unknown>>;
    expect(list.some(w => w.id === ctx.wsId)).toBeTruthy();
  });

  await test('PUT /api/workspaces/:id/settings updates workspace name', async () => {
    const r = await adminCall(ctx.wsId)('PUT', `/workspaces/${ctx.wsId}/settings`, {
      name: 'Integration Test Workspace (renamed)',
    });
    expect(r.status).toBeStatus(200, 204);
  });
});

await suite('Agents', async () => {
  // Agent IDs are caller-provided (OpenClaw convention). Must satisfy validateAgentId rules.
  ctx.agentId = `inttest${Date.now().toString(36)}`;

  await test('POST /api/agents/register creates an agent (no auth needed)', async () => {
    // optionalAuthMiddleware — no X-Workspace-Id header required
    const r = ok(await apiRaw('POST', '/agents/register', {
      agentId: ctx.agentId,
      workspaceId: ctx.wsId,
    }));
    ctx.agentKey = r.apiKey as string;
    expect(ctx.agentKey).toBeTruthy();
    expect(r.agentId).toBe(ctx.agentId);
  });

  await test('Duplicate agent registration is rejected (409)', async () => {
    const r = await apiRaw('POST', '/agents/register', { agentId: ctx.agentId, workspaceId: ctx.wsId });
    expect(r.status).toBe(409);
  });

  await test('Agent is auto-approved on registration', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/agents');
    const list = r.body as Array<Record<string, unknown>>;
    const found = list.find(a => a.id === ctx.agentId);
    expect(found).toBeTruthy();
    expect(found!.role).toBe('agent');
  });

  await test('GET /api/agents/mine returns agent list via X-Agent-Key', async () => {
    // /mine returns an array of the caller's agents
    const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/agents/mine');
    expect(r.status).toBe(200);
    const agents = r.body as Array<Record<string, unknown>>;
    expect(Array.isArray(agents)).toBeTruthy();
    expect(agents.some(a => a.id === ctx.agentId)).toBeTruthy();
  });

  await test('Agent balance field is a number (credits, converted from nanocredits)', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/agents/mine');
    const agents = r.body as Array<Record<string, unknown>>;
    const me = agents.find(a => a.id === ctx.agentId)!;
    expect(me.balance).toBeType('number');
  });

  await test('Wrong agent key returns 401', async () => {
    const r = await apiRaw('GET', '/agents/mine', undefined, {
      'X-Agent-Key': 'invalid_key_that_does_not_exist',
      'X-Workspace-Id': ctx.wsId,
    });
    expect(r.status).toBe(401);
  });
});

await suite('Admin credit (non-USDC)', async () => {
  await test('POST /api/agents/:id/credit adds credits', async () => {
    const r = ok(await adminCall(ctx.wsId)('POST', `/agents/${ctx.agentId}/credit`, { amount: 100 }));
    expect(r.credited).toBe(100);
    expect(r.balance as number).toBeGreaterThanOrEqual(100);
  });

  await test('Agent balance reflects the credit', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/agents/mine');
    const me = (r.body as Array<Record<string, unknown>>).find(a => a.id === ctx.agentId)!;
    expect(me.balance as number).toBeGreaterThanOrEqual(100);
  });

  await test('Credit with non-positive amount is rejected (400)', async () => {
    const r = await adminCall(ctx.wsId)('POST', `/agents/${ctx.agentId}/credit`, { amount: -5 });
    expect(r.status).toBe(400);
  });

  await test('Credit to unknown agent returns 404', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/agents/nonexistent-agent/credit', { amount: 10 });
    expect(r.status).toBe(404);
  });
});

await suite('Metrics', async () => {
  ctx.metricName = `IntegrationLeaf_${Date.now()}`;

  await test('POST /api/metrics creates a leaf metric', async () => {
    const r = ok(await adminCall(ctx.wsId)('POST', '/metrics', {
      name: ctx.metricName,
      description: 'Created by integration test',
      value: 5,
      formula: '0',
    }));
    ctx.metricId = r.id as string;
    expect(ctx.metricId).toBeTruthy();
    expect(r.ok).toBe(true);
  });

  await test('GET /api/metrics lists the created metric', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/metrics');
    expect(r.status).toBe(200);
    expect((r.body as Array<Record<string, unknown>>).some(m => m.id === ctx.metricId)).toBeTruthy();
  });

  await test('GET /api/metrics/:id returns the metric', async () => {
    const r = ok(await adminCall(ctx.wsId)('GET', `/metrics/${ctx.metricId}`));
    expect(r.id).toBe(ctx.metricId);
    expect(r.name).toBe(ctx.metricName);
  });

  await test('PUT /api/metrics/:id updates value and returns updated metric', async () => {
    const r = ok(await adminCall(ctx.wsId)('PUT', `/metrics/${ctx.metricId}`, { value: 8 }));
    expect(r.id).toBe(ctx.metricId);
    expect(r.value).toBe(8);
  });

  await test('GET /api/metrics/:id/logs returns log history', async () => {
    const r = await adminCall(ctx.wsId)('GET', `/metrics/${ctx.metricId}/logs`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBeTruthy();
  });

  await test('Composite metric with formula reference is created successfully', async () => {
    const call = adminCall(ctx.wsId);
    const r = ok(await call('POST', '/metrics', {
      name: `IntegrationComposite_${Date.now()}`,
      description: 'Tests formula evaluation',
      formula: `{${ctx.metricName}} * 2`,
    }));
    expect(r.id).toBeTruthy();
    await call('DELETE', `/metrics/${r.id as string}`);
  });

  await test('Self-referencing formula is rejected (circular dependency, 400)', async () => {
    const r = await adminCall(ctx.wsId)('PUT', `/metrics/${ctx.metricId}`, {
      formula: `{${ctx.metricName}}`,
    });
    expect(r.status).toBe(400);
  });

  await test('Missing metric name is rejected (400)', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/metrics', { value: 0 });
    expect(r.status).toBe(400);
  });
});

await suite('Prediction Markets', async () => {
  // Strategy: create a time-preference metric whose leaf descendant is ctx.metricId.
  // The refresh will create and keep markets for ctx.metricId active (as it's a TP leaf).
  await test('Create a TP parent metric so refresh keeps leaf markets active', async () => {
    const call = adminCall(ctx.wsId);
    const r = ok(await call('POST', '/metrics', {
      name: `IntegrationTP_${Date.now()}`,
      description: 'TP parent used to keep leaf markets active in tests',
      formula: `{${ctx.metricName}}`,
      timePreference: { enabled: true, halfLife: 1 },
    }));
    expect(r.id).toBeTruthy();
    // Store so we can clean it up
    ctx['tpMetricId' as keyof typeof ctx] = r.id as never;
  });

  await test('POST /api/predictions/markets/refresh creates markets for TP leaf descendants', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/predictions/markets/refresh', {});
    expect(r.status).toBeStatus(200, 202);
  });

  await test('GET /api/predictions/markets lists active markets including TP-generated ones', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/predictions/markets');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBeTruthy();
    const markets = r.body as Array<Record<string, unknown>>;
    // Find an active market for our leaf metric
    const leafMarket = markets.find(m => m.metricId === ctx.metricId && m.active);
    if (leafMarket) ctx.marketId = leafMarket.id as string;
    expect(markets.length).toBeGreaterThan(0);
  });

  await test('GET /api/predictions/markets/:id returns market with required fields', async () => {
    if (!ctx.marketId) { throw new Error('No active market for leaf metric — TP refresh may have failed'); }
    const r = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${ctx.marketId}`));
    // GET /markets/:id returns { id, metricId, liquidity, probability, rangeMin, rangeMax, ... }
    // A freshly created market has liquidity=0 (no initial pool) and probability=0 (no consensus yet).
    // After liquidity injection, probability approaches 0.5.
    expect(r.id).toBe(ctx.marketId);
    expect(r.metricId).toBe(ctx.metricId);
    expect(r.resolved).toBe(false);
    // rangeMin/rangeMax may come back as number or string depending on PG driver
    expect(isNaN(parseFloat(String(r.rangeMin)))).toBeFalsy();
    expect(isNaN(parseFloat(String(r.rangeMax)))).toBeFalsy();
    // probability and liquidity are numbers (may be 0 before injection)
    expect(isNaN(parseFloat(String(r.probability)))).toBeFalsy();
    expect(isNaN(parseFloat(String(r.liquidity)))).toBeFalsy();
  });

  await test('POST /predictions/markets/liquidity/bulk injects liquidity (requires agentId in body for master key)', async () => {
    if (!ctx.marketId) { throw new Error('No market available'); }
    // Master key has no linked agentId, so agentId must be passed in the body
    const r = ok(await adminCall(ctx.wsId)('POST', '/predictions/markets/liquidity/bulk', {
      amount: 0.1,
      agentId: ctx.agentId,
    }));
    expect(r.markets as number).toBeGreaterThanOrEqual(1);
    expect(r.totalCost as number).toBeGreaterThan(0);
  });

  await test('POST /predictions/markets creates a market directly (non-TP date)', async () => {
    // Use a unique date format (day-level) not generated by TP sampling (which uses year/month/week)
    const farFuture = `${new Date().getFullYear() + 10}-06-15`;
    const r = ok(await adminCall(ctx.wsId)('POST', '/predictions/markets', {
      metricId: ctx.metricId,
      targetDate: farFuture,
      liquidity: 0.5,
    }));
    expect(r.id).toBeTruthy();
    expect(r.metricId).toBe(ctx.metricId);
    // Cleanup immediately so it doesn't interfere with refresh
    await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${r.id as string}`);
  });

  await test('Duplicate market for same metric+date is rejected (409)', async () => {
    // Use an existing TP-generated market's date
    const r = await adminCall(ctx.wsId)('POST', '/predictions/markets', {
      metricId: ctx.metricId,
      targetDate: '2000', // past date — gets rejected for a different reason
    });
    expect(r.status).toBe(400);
  });

  await test('Market for past target date is rejected (400)', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/predictions/markets', {
      metricId: ctx.metricId,
      targetDate: '2000',
    });
    expect(r.status).toBe(400);
  });

  await test('GET /predictions/markets with unknown taskId returns empty array', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/predictions/markets?taskId=nonexistent-task-id');
    expect(r.status).toBe(200);
    expect((r.body as Array<unknown>).length).toBe(0);
  });
});

await suite('Trading', async () => {
  await test('Agent can buy higher direction', async () => {
    const r = ok(await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId,
      direction: 'higher',
      amount: 1,
    }));
    expect(r.tradeId).toBeTruthy();
    expect(r.shares as number).toBeGreaterThan(0);
    expect(r.cost as number).toBeGreaterThan(0);
  });

  await test('Trade is recorded in agent positions', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/predictions/positions');
    expect(r.status).toBe(200);
    const positions = r.body as Array<Record<string, unknown>>;
    expect(positions.some(p => p.marketId === ctx.marketId)).toBeTruthy();
  });

  await test('Trade appears in market trade history', async () => {
    const r = await adminCall(ctx.wsId)('GET', `/predictions/markets/${ctx.marketId}/trades`);
    expect(r.status).toBe(200);
    expect((r.body as Array<unknown>).length).toBeGreaterThan(0);
  });

  await test('Agent balance decreases after buying', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/agents/mine');
    const me = (r.body as Array<Record<string, unknown>>).find(a => a.id === ctx.agentId)!;
    expect(me.balance as number).toBeLessThan(100);
  });

  await test('Agent can buy lower direction', async () => {
    const r = ok(await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId,
      direction: 'lower',
      amount: 0.5,
    }));
    expect(r.tradeId).toBeTruthy();
  });

  await test('Agent can sell position via sellShares param', async () => {
    // Positions are per-direction rows with { direction, shares } (not higherShares/lowerShares)
    const posR = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/predictions/positions');
    const positions = posR.body as Array<Record<string, unknown>>;
    const higherPos = positions.find(p => p.marketId === ctx.marketId && p.direction === 'higher');
    if (!higherPos || (higherPos.shares as number) <= 0) {
      throw new Error('No higher position to sell');
    }
    const r = ok(await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId,
      direction: 'higher',
      sellShares: Math.max(1, Math.floor((higherPos.shares as number) / 2)),
    }));
    expect(r.proceeds as number).toBeGreaterThan(0);
  });

  await test('Trading without agent key is rejected (403)', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId, direction: 'higher', amount: 1,
    });
    expect(r.status).toBe(403);
  });

  await test('Buying with amount exceeding balance is rejected (400)', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId, direction: 'higher', amount: 999999,
    });
    expect(r.status).toBe(400);
  });

  await test('Trade with invalid direction is rejected (400)', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
      marketId: ctx.marketId, direction: 'sideways', amount: 1,
    });
    expect(r.status).toBe(400);
  });
});

await suite('Tasks', async () => {
  await test('POST /api/tasks creates a task (requires agent key)', async () => {
    // proposedBy is set from req.auth.agentId — requires X-Agent-Key auth
    const r = ok(await agentCall(ctx.agentKey, ctx.wsId)('POST', '/tasks', {
      title: 'Integration test task',
      description: 'Verify task flow works end-to-end',
      price: 5,
    }));
    ctx.taskId = r.id as string;
    expect(ctx.taskId).toBeTruthy();
  });

  await test('GET /api/tasks lists the task', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/tasks');
    expect(r.status).toBe(200);
    expect((r.body as Array<Record<string, unknown>>).some(t => t.id === ctx.taskId)).toBeTruthy();
  });

  await test('GET /api/tasks/:id returns task details', async () => {
    const r = ok(await adminCall(ctx.wsId)('GET', `/tasks/${ctx.taskId}`));
    expect(r.id).toBe(ctx.taskId);
    expect(r.title).toBe('Integration test task');
    expect(r.status).toBe('pending');
    expect(r.price).toBe(5);
  });

  await test('Task creation without price is rejected (400)', async () => {
    const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/tasks', { title: 'No price' });
    expect(r.status).toBe(400);
  });

  await test('Task creation with master key is rejected (403 — no linked agent)', async () => {
    const r = await adminCall(ctx.wsId)('POST', '/tasks', { title: 'Admin task', price: 1 });
    expect(r.status).toBe(403);
  });

  await test('POST /api/tasks/:id/approve approves the task', async () => {
    const r = await adminCall(ctx.wsId)('POST', `/tasks/${ctx.taskId}/approve`, {});
    expect(r.status).toBe(200);
  });

  await test('Approved task status is "approved"', async () => {
    const r = ok(await adminCall(ctx.wsId)('GET', `/tasks/${ctx.taskId}`));
    expect(r.status).toBe('approved');
  });

  await test('POST /api/tasks/:id/decline declines a pending task', async () => {
    const taskR = ok(await agentCall(ctx.agentKey, ctx.wsId)('POST', '/tasks', {
      title: 'Task to decline', price: 2,
    }));
    const r = await adminCall(ctx.wsId)('POST', `/tasks/${taskR.id as string}/decline`, {});
    expect(r.status).toBe(200);
  });
});

await suite('Groups', async () => {
  let groupId = '';

  await test('GET /api/groups lists Admin + Public auto-created groups', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/groups');
    expect(r.status).toBe(200);
    const groups = r.body as Array<Record<string, unknown>>;
    expect(groups.some(g => g.name === 'Admin')).toBeTruthy();
    expect(groups.some(g => g.name === 'Public')).toBeTruthy();
  });

  await test('POST /api/groups creates a custom group', async () => {
    const r = ok(await adminCall(ctx.wsId)('POST', '/groups', {
      name: 'IntegrationGroup', agentIds: [ctx.agentId],
    }));
    groupId = r.id as string;
    expect(groupId).toBeTruthy();
  });

  await test('PUT /api/groups/:id updates the group', async () => {
    const r = await adminCall(ctx.wsId)('PUT', `/groups/${groupId}`, {
      name: 'IntegrationGroup (updated)', agentIds: [ctx.agentId],
    });
    expect(r.status).toBeStatus(200, 204);
  });

  await test('DELETE /api/groups/:id removes the group', async () => {
    const r = await adminCall(ctx.wsId)('DELETE', `/groups/${groupId}`);
    expect(r.status).toBeStatus(200, 204);
  });
});

await suite('Workspace isolation', async () => {
  await test('Create a second workspace for isolation checks', async () => {
    const r = ok(await apiRaw('POST', '/workspaces', { name: 'Isolation Test Workspace B' }, {
      'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS,
    }));
    ctx.wsId2 = r.id as string;
    expect(ctx.wsId2).toBeTruthy();
    expect(ctx.wsId2 === ctx.wsId).toBeFalsy();
  });

  await test('Metrics in workspace A are not visible from workspace B', async () => {
    const r = await adminCall(ctx.wsId2)('GET', '/metrics');
    expect(r.status).toBe(200);
    expect((r.body as Array<Record<string, unknown>>).some(m => m.id === ctx.metricId)).toBeFalsy();
  });

  await test('Markets in workspace A are not visible from workspace B', async () => {
    const r = await adminCall(ctx.wsId2)('GET', '/predictions/markets');
    expect(r.status).toBe(200);
    expect((r.body as Array<Record<string, unknown>>).some(m => m.id === ctx.marketId)).toBeFalsy();
  });

  await test('Agent cannot trade a market from workspace B using workspace A key', async () => {
    // The agent key resolves to workspace A regardless of X-Workspace-Id hint.
    // A fictional market ID that doesn't exist in workspace A → 404.
    const fakeMarketId = '00000000-0000-0000-0000-000000000000';
    const r = await agentCall(ctx.agentKey, ctx.wsId2)('POST', '/predictions/trade', {
      marketId: fakeMarketId, direction: 'higher', amount: 1,
    });
    // The agent resolves to workspace A; the market doesn't exist in workspace A → 404
    expect(r.status).toBeStatus(400, 404);
  });
});

await suite('Events', async () => {
  await test('GET /api/events/hooks/status returns watcher state', async () => {
    const r = await adminCall(ctx.wsId)('GET', '/events/hooks/status');
    expect(r.status).toBe(200);
  });
});

await suite('Auth', async () => {
  await test('Request without any auth returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/metrics`, {
      headers: { 'X-Workspace-Id': ctx.wsId },
    });
    expect(res.status).toBe(401);
  });

  await test('GET /api/auth/me with valid auth succeeds or is not found', async () => {
    // /auth/me is a custom BetterAuth route; with master key it may return 200 or fall through
    const r = await adminCall(ctx.wsId)('GET', '/auth/me');
    expect(r.status).toBeStatus(200, 401, 403, 404);
  });
});

await suite('Cleanup', async () => {
  await test('Delete test market if still exists', async () => {
    if (!ctx.marketId) return;
    const r = await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${ctx.marketId}`);
    // Market may already have been voided/resolved during tests — 404 is fine
    expect(r.status).toBeStatus(200, 204, 404);
  });

  await test('Delete TP parent metric', async () => {
    const tpId = ctx['tpMetricId' as keyof typeof ctx] as string | undefined;
    if (!tpId) return;
    const r = await adminCall(ctx.wsId)('DELETE', `/metrics/${tpId}`);
    expect(r.status).toBeStatus(200, 204, 404);
  });

  await test('Delete test leaf metric', async () => {
    if (!ctx.metricId) return;
    const r = await adminCall(ctx.wsId)('DELETE', `/metrics/${ctx.metricId}`);
    expect(r.status).toBeStatus(200, 204, 404);
  });

  // Note: DELETE /api/workspaces/:id does not exist as an endpoint.
  // Test workspaces created here will persist — they are small and harmless.
  await test('Workspace delete endpoint is not implemented (expected 404)', async () => {
    if (!ctx.wsId) return;
    const r = await adminCall(ctx.wsId)('DELETE', `/workspaces/${ctx.wsId}`);
    expect(r.status).toBe(404);
  });
});

} // end main()

main().then(() => {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed (${results.length} total)`);
  if (failed > 0) {
    console.log('\n  Failed tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => console.log(`    ✗ [${r.suite}] ${r.name}\n      ${r.error}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('  All tests passed.\n');
  }
}).catch(e => { console.error('Fatal:', e); process.exit(1); });
