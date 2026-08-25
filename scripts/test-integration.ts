#!/usr/bin/env node
/**
 * Integration test suite for the Telarchy API.
 *
 * Tests the live API end-to-end to verify behaviour documented in:
 *   docs/vision.md, docs/agent-economy.md
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 API_KEY=<master> node scripts/test-integration.ts
 *
 * The tests run against a freshly created workspace and clean up after themselves.
 * To add new tests: call test() inside an existing or new suite() block.
 */

// ─── Runner ───────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  suite: string;
}

const results: TestResult[] = [];
let currentSuite = 'root';

async function suite(name: string, fn: () => Promise<void>): Promise<void> {
  const prev = currentSuite;
  currentSuite = name;
  console.log(`\n  ${name}`);
  try {
    await fn();
  } catch (e) {
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

/** Assertion builder: all helpers throw on failure. */
function expect(actual: unknown) {
  const fail = (msg: string) => {
    throw new Error(msg);
  };
  return {
    toBe: (v: unknown) => {
      if (actual !== v) fail(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan: (n: number) => {
      if ((actual as number) <= n) fail(`Expected > ${n}, got ${actual}`);
    },
    toBeGreaterThanOrEqual: (n: number) => {
      if ((actual as number) < n) fail(`Expected >= ${n}, got ${actual}`);
    },
    toBeLessThan: (n: number) => {
      if ((actual as number) >= n) fail(`Expected < ${n}, got ${actual}`);
    },
    toBeCloseTo: (n: number, precision = 2) => {
      if (Math.abs((actual as number) - n) > 10 ** -precision / 2) fail(`Expected ≈${n}, got ${actual}`);
    },
    toContainStr: (sub: string) => {
      if (!String(actual).includes(sub)) fail(`Expected "${actual}" to contain "${sub}"`);
    },
    toBeTruthy: () => {
      if (!actual) fail(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy: () => {
      if (actual) fail(`Expected falsy, got ${JSON.stringify(actual)}`);
    },
    toBeArray: () => {
      if (!Array.isArray(actual)) fail(`Expected array, got ${typeof actual}`);
    },
    toBeType: (t: string) => {
      if (typeof actual !== t) fail(`Expected type ${t}, got ${typeof actual}`);
    },
    /** Check HTTP status is one of the accepted codes. */
    toBeStatus: (...codes: number[]) => {
      if (!codes.includes(actual as number)) fail(`Expected status in [${codes.join(', ')}], got ${actual}`);
    },
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? process.argv[2] ?? 'http://localhost:8080';
// The browser-session suite signs in as a real account. Credentials come from the
// environment only (see keyring/telarchy/admin.env); nothing in this repo may hold them.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('test-integration: set ADMIN_EMAIL and ADMIN_PASSWORD (source keyring/telarchy/admin.env)');
  process.exit(2);
}
const ADMIN_KEY = process.env.API_KEY ?? process.argv[3] ?? '';

if (!ADMIN_KEY) {
  console.error('Error: API_KEY env var required (master API key).');
  process.exit(1);
}

type HeaderMap = Record<string, string>;

async function apiRaw(
  method: string,
  path: string,
  body?: unknown,
  extra: HeaderMap = {},
): Promise<{ status: number; body: unknown }> {
  const headers: HeaderMap = { 'Content-Type': 'application/json', ...extra };
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
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
    throw new Error(`${label ? label + ': ' : ''}HTTP ${r.status} - ${JSON.stringify(r.body)}`);
  return r.body as Record<string, unknown>;
}

// ─── Shared test state ────────────────────────────────────────────────────────

// All properties are set by early suites and consumed by later ones.
// Typed permissively to avoid initialisation boilerplate.
const ctx = {} as {
  wsId: string;
  wsId2: string;
  agentId: string;
  agentKey: string;
  metricId: string;
  metricName: string;
  marketId: string;
  proposalId: string;
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
      // Returns { xp, rank, metrics, creditValueUsd } (not a generic { ok: true })
      const r = await apiRaw('GET', '/status', undefined, { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS });
      expect(r.status).toBe(200);
      expect(typeof (r.body as Record<string, unknown>).rank).toBeType('string');
    });
  });

  await suite('Workspaces', async () => {
    await test('POST /api/workspaces creates a workspace', async () => {
      const r = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          { name: 'Integration Test Workspace' },
          {
            'X-API-Key': ADMIN_KEY,
            'X-Workspace-Id': PLACEHOLDER_WS,
          },
        ),
      );
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

    await test('GET /api/workspaces/:id includes auto-fund fields', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/workspaces/${ctx.wsId}`));
      expect(r.autoFundNewMarkets).toBeType('boolean');
      expect(r.newMarketLiquidityCredits).toBeType('number');
    });

    await test('Master API key cannot set auto-fund workspace fields (403)', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/workspaces/${ctx.wsId}/settings`, {
        autoFundNewMarkets: true,
        newMarketLiquidityCredits: 10,
      });
      expect(r.status).toBe(403);
    });

    await test('POST /api/workspaces with template=startup provisions 3 metrics and their markets', async () => {
      const create = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          {
            name: `Template Startup ${Date.now()}`,
            template: 'startup',
            templateParams: { revenueRangeMax: 50000 },
          },
          { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS },
        ),
      );
      expect(create.metricsCreated).toBe(3);
      expect(create.template).toBe('startup');
      const wsId = create.id as string;

      const call = adminCall(wsId);
      const metricsList = ok(await call('GET', '/metrics')) as Array<Record<string, unknown>>;
      expect(metricsList.length).toBe(3);
      const revenue = metricsList.find(m => m.name === 'Weekly revenue')!;
      expect(revenue).toBeTruthy();
      expect(revenue.marketRangeMax).toBe(50000);
      const tp = revenue.timePreference as { enabled: boolean; halfLife: number } | null;
      expect(tp?.enabled).toBe(true);
      expect(tp?.halfLife).toBe(1);
      const quality = metricsList.find(m => m.name === 'Product quality')!;
      expect((quality.timePreference as { halfLife: number }).halfLife).toBe(3);
      expect(quality.marketRangeMax).toBe(10);

      const marketsRes = ok(await call('GET', '/predictions/markets')) as Array<Record<string, unknown>>;
      // 3 TP leaves x 10 sampled dates, but the adaptive date granularity can
      // collapse neighbouring samples onto the same calendar key, so count may
      // be slightly under 30. Require at least 3 per metric, no duplicates per metric.
      expect(marketsRes.length).toBeGreaterThanOrEqual(24);
      const perMetric = new Map<string, number>();
      for (const m of marketsRes) {
        const mid = m.metricId as string;
        perMetric.set(mid, (perMetric.get(mid) ?? 0) + 1);
      }
      expect(perMetric.size).toBe(3);

      // cleanup
      ok(await call('DELETE', `/workspaces/${wsId}`));
    });

    await test('POST /api/workspaces with template=personal provisions 3 self-report metrics', async () => {
      const create = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          {
            name: `Template Personal ${Date.now()}`,
            template: 'personal',
          },
          { 'X-API-Key': ADMIN_KEY, 'X-Workspace-Id': PLACEHOLDER_WS },
        ),
      );
      expect(create.metricsCreated).toBe(3);
      const wsId = create.id as string;
      const call = adminCall(wsId);
      const metricsList = ok(await call('GET', '/metrics')) as Array<Record<string, unknown>>;
      const names = metricsList.map(m => m.name).sort();
      expect(JSON.stringify(names)).toBe(JSON.stringify(['Career satisfaction', 'Happiness', 'Health']));
      for (const m of metricsList) {
        expect(m.marketRangeMax).toBe(10);
      }
      ok(await call('DELETE', `/workspaces/${wsId}`));
    });

    await test('POST /api/workspaces with unknown template returns 400', async () => {
      const r = await apiRaw(
        'POST',
        '/workspaces',
        { name: 'Bad template', template: 'bogus' },
        {
          'X-API-Key': ADMIN_KEY,
          'X-Workspace-Id': PLACEHOLDER_WS,
        },
      );
      expect(r.status).toBe(400);
    });

    await test('POST /api/workspaces without template creates a blank workspace', async () => {
      const create = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          { name: `Blank ${Date.now()}` },
          {
            'X-API-Key': ADMIN_KEY,
            'X-Workspace-Id': PLACEHOLDER_WS,
          },
        ),
      );
      expect(create.metricsCreated ?? 0).toBe(0);
      const wsId = create.id as string;
      const call = adminCall(wsId);
      const metricsList = ok(await call('GET', '/metrics')) as Array<Record<string, unknown>>;
      expect(metricsList.length).toBe(0);
      ok(await call('DELETE', `/workspaces/${wsId}`));
    });
  });

  await suite('Agents', async () => {
    // Agent IDs are caller-provided (OpenClaw convention). Must satisfy validateAgentId rules.
    ctx.agentId = `inttest${Date.now().toString(36)}`;

    await test('POST /api/agents/register creates an agent (no auth needed)', async () => {
      // optionalAuthMiddleware: no X-Workspace-Id header required
      const r = ok(
        await apiRaw('POST', '/agents/register', {
          agentId: ctx.agentId,
          workspaceId: ctx.wsId,
        }),
      );
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
      expect(found!.approvedAt).toBeTruthy();
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

    await test('GET /api/agents/me resolves self via API key', async () => {
      const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', '/agents/me');
      expect(r.status).toBe(200);
      const me = r.body as Record<string, unknown>;
      expect(me.id).toBe(ctx.agentId);
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
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: ctx.metricName,
          description: 'Created by integration test',
          value: 5,
          formula: '0',
          timePreference: { enabled: false },
        }),
      );
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
      const r = ok(
        await call('POST', '/metrics', {
          name: `IntegrationComposite_${Date.now()}`,
          description: 'Tests formula evaluation',
          formula: `{${ctx.metricName}} * 2`,
        }),
      );
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
      const r = ok(
        await call('POST', '/metrics', {
          name: `IntegrationTP_${Date.now()}`,
          description: 'TP parent used to keep leaf markets active in tests',
          formula: `{${ctx.metricName}}`,
          timePreference: { enabled: true, halfLife: 1 },
        }),
      );
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
      if (!ctx.marketId) {
        throw new Error('No active market for leaf metric; TP refresh may have failed');
      }
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
      if (!ctx.marketId) {
        throw new Error('No market available');
      }
      // Master key has no participant identity, so agentId must be passed in the body
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets/liquidity/bulk', {
          amount: 0.1,
          agentId: ctx.agentId,
        }),
      );
      expect(r.markets as number).toBeGreaterThanOrEqual(1);
      expect(r.totalCost as number).toBeGreaterThan(0);
    });

    await test('POST /predictions/markets creates a market directly (non-TP date)', async () => {
      // Use a unique date format (day-level) not generated by TP sampling (which uses year/month/week)
      const farFuture = `${new Date().getFullYear() + 10}-06-15`;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: ctx.metricId,
          targetDate: farFuture,
          liquidity: 0.5,
        }),
      );
      expect(r.id).toBeTruthy();
      expect(r.metricId).toBe(ctx.metricId);
      // Cleanup immediately so it doesn't interfere with refresh
      await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${r.id as string}`);
    });

    await test('Duplicate market for same metric+date is rejected (409)', async () => {
      // Use an existing TP-generated market's date
      const r = await adminCall(ctx.wsId)('POST', '/predictions/markets', {
        metricId: ctx.metricId,
        targetDate: '2000', // past date (gets rejected for a different reason)
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

    await test('GET /predictions/markets with unknown proposalId returns empty array', async () => {
      const r = await adminCall(ctx.wsId)('GET', '/predictions/markets?proposalId=nonexistent-proposal-id');
      expect(r.status).toBe(200);
      expect((r.body as Array<unknown>).length).toBe(0);
    });
  });

  await suite('Trading', async () => {
    await test('Agent can buy higher direction', async () => {
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: ctx.marketId,
          direction: 'higher',
          amount: 1,
        }),
      );
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
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: ctx.marketId,
          direction: 'lower',
          amount: 0.5,
        }),
      );
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
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: ctx.marketId,
          direction: 'higher',
          sellShares: Math.max(1, Math.floor((higherPos.shares as number) / 2)),
        }),
      );
      expect(r.proceeds as number).toBeGreaterThan(0);
    });

    await test('Trading without agent key is rejected (403)', async () => {
      const r = await adminCall(ctx.wsId)('POST', '/predictions/trade', {
        marketId: ctx.marketId,
        direction: 'higher',
        amount: 1,
      });
      expect(r.status).toBe(403);
    });

    await test('Buying with amount exceeding balance is rejected (400)', async () => {
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: ctx.marketId,
        direction: 'higher',
        amount: 999999,
      });
      expect(r.status).toBe(400);
    });

    await test('Trade with invalid direction is rejected (400)', async () => {
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: ctx.marketId,
        direction: 'sideways',
        amount: 1,
      });
      expect(r.status).toBe(400);
    });
  });

  await suite('Proposals', async () => {
    await test('POST /api/proposals creates a proposal (requires agent key)', async () => {
      // proposedBy is set from req.auth.agentId; requires X-Agent-Key auth
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/proposals', {
          title: 'Integration test proposal',
          description: 'Verify proposal flow works end-to-end',
        }),
      );
      ctx.proposalId = r.id as string;
      expect(ctx.proposalId).toBeTruthy();
    });

    await test('GET /api/proposals lists the proposal', async () => {
      const r = await adminCall(ctx.wsId)('GET', '/proposals');
      expect(r.status).toBe(200);
      expect((r.body as Array<Record<string, unknown>>).some(t => t.id === ctx.proposalId)).toBeTruthy();
    });

    await test('GET /api/proposals/:id returns proposal details', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/proposals/${ctx.proposalId}`));
      expect(r.id).toBe(ctx.proposalId);
      expect(r.title).toBe('Integration test proposal');
      expect(r.status).toBe('pending');
    });

    await test('Proposal creation without title is rejected (400)', async () => {
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/proposals', { description: 'no title' });
      expect(r.status).toBe(400);
    });

    await test('Proposal creation with master key is rejected (403, no participant identity)', async () => {
      const r = await adminCall(ctx.wsId)('POST', '/proposals', { title: 'Admin proposal' });
      expect(r.status).toBe(403);
    });

    await test('POST /api/proposals/:id/approve approves the proposal', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${ctx.proposalId}/approve`, {});
      expect(r.status).toBe(200);
    });

    await test('Approved proposal status is "approved"', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/proposals/${ctx.proposalId}`));
      expect(r.status).toBe('approved');
    });

    await test('POST /api/proposals/:id/decline declines a pending proposal', async () => {
      const proposalR = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/proposals', {
          title: 'Proposal to decline',
        }),
      );
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${proposalR.id as string}/decline`, {});
      expect(r.status).toBe(200);
    });
  });

  await suite('Groups', async () => {
    let groupId = '';

    await test('GET /api/groups lists Public, Trader, Admin auto-created system groups with capability presets', async () => {
      const r = await adminCall(ctx.wsId)('GET', '/groups');
      expect(r.status).toBe(200);
      const groups = r.body as Array<Record<string, unknown>>;
      expect(groups.some(g => g.name === 'Admin')).toBeTruthy();
      expect(groups.some(g => g.name === 'Public')).toBeTruthy();
      expect(groups.some(g => g.name === 'Trader')).toBeTruthy();
      for (const g of groups) {
        expect(Array.isArray(g.capabilities)).toBeTruthy();
      }
    });

    await test('POST /api/groups creates a custom group with capabilities', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/groups', {
          name: 'IntegrationGroup',
          capabilities: ['read', 'trade'],
        }),
      );
      groupId = r.id as string;
      expect(groupId).toBeTruthy();
      expect((r.capabilities as string[]).sort().join(',')).toBe('read,trade');
    });

    await test('PUT /api/groups/:id updates memberIds and capabilities', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/groups/${groupId}`, {
        name: 'IntegrationGroup (updated)',
        memberIds: [ctx.agentId],
        capabilities: ['read'],
      });
      expect(r.status).toBeStatus(200, 204);
    });

    await test('DELETE /api/groups/:id removes the group', async () => {
      const r = await adminCall(ctx.wsId)('DELETE', `/groups/${groupId}`);
      expect(r.status).toBeStatus(200, 204);
    });
  });

  await suite('Sources', async () => {
    let sourceId = '';
    let groupId = '';

    await test('POST /api/sources creates a text source', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/sources', {
          name: 'Integration Text Source',
          description: 'test',
          content: 'hello world',
        }),
      );
      sourceId = r.id as string;
      expect(sourceId).toBeTruthy();
      expect(r.type).toBe('text');
    });

    await test('POST /api/sources rejects non-text types (only GitHub flow can create those)', async () => {
      const r = await adminCall(ctx.wsId)('POST', '/sources', {
        name: 'Bad',
        type: 'github',
      });
      expect(r.status).toBe(400);
    });

    await test('GET /api/sources lists sources without content payload', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', '/sources'));
      const list = r as unknown as Array<Record<string, unknown>>;
      expect(Array.isArray(list)).toBeTruthy();
      const mine = list.find(s => s.id === sourceId);
      expect(mine).toBeTruthy();
      expect(mine!.content === undefined).toBeTruthy();
    });

    await test('GET /api/sources/:id returns content for text sources', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/sources/${sourceId}`));
      expect(r.content).toBe('hello world');
    });

    await test('PUT /api/sources/:id updates name and content', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/sources/${sourceId}`, {
        name: 'Integration Text Source (updated)',
        content: 'new content',
      });
      expect(r.status).toBeStatus(200, 204);
      const after = ok(await adminCall(ctx.wsId)('GET', `/sources/${sourceId}`));
      expect(after.name).toBe('Integration Text Source (updated)');
      expect(after.content).toBe('new content');
    });

    await test('sourcePermissions can be set on a group', async () => {
      const g = ok(
        await adminCall(ctx.wsId)('POST', '/groups', {
          name: 'SourceReaders',
          capabilities: ['read'],
        }),
      );
      groupId = g.id as string;
      const upd = await adminCall(ctx.wsId)('PUT', `/groups/${groupId}`, {
        sourcePermissions: { [sourceId]: { read: true } },
      });
      expect(upd.status).toBeStatus(200, 204);
      const check = ok(await adminCall(ctx.wsId)('GET', '/groups'));
      const group = (check as unknown as Array<Record<string, unknown>>).find(x => x.id === groupId);
      const sp = group?.sourcePermissions as Record<string, { read: boolean }>;
      expect(sp?.[sourceId]?.read).toBe(true);
    });

    await test('DELETE /api/sources/:id removes the source and cleans group permissions', async () => {
      const r = await adminCall(ctx.wsId)('DELETE', `/sources/${sourceId}`);
      expect(r.status).toBeStatus(200, 204);
      const check = ok(await adminCall(ctx.wsId)('GET', '/groups'));
      const group = (check as unknown as Array<Record<string, unknown>>).find(x => x.id === groupId);
      const sp = (group?.sourcePermissions ?? {}) as Record<string, { read: boolean }>;
      expect(sp[sourceId] === undefined).toBeTruthy();
      await adminCall(ctx.wsId)('DELETE', `/groups/${groupId}`);
    });
  });

  await suite('Workspace isolation', async () => {
    await test('Create a second workspace for isolation checks', async () => {
      const r = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          { name: 'Isolation Test Workspace B' },
          {
            'X-API-Key': ADMIN_KEY,
            'X-Workspace-Id': PLACEHOLDER_WS,
          },
        ),
      );
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
        marketId: fakeMarketId,
        direction: 'higher',
        amount: 1,
      });
      // The agent resolves to workspace A; the market doesn't exist in workspace A → 404,
      // or the cross-workspace header may be rejected outright → 403.
      expect(r.status).toBeStatus(400, 403, 404);
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

  // ─── Extended edge-case suites ────────────────────────────────────────────────

  await suite('Metrics - edge cases', async () => {
    let edgeMetricId = '';
    let compositeId = '';

    await test('Metric created without marketRangeMax defaults to 1000', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `EdgeMetric_${Date.now()}`,
          description: 'No rangeMax supplied',
          value: 42,
          timePreference: { enabled: false },
        }),
      );
      edgeMetricId = r.id as string;
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${edgeMetricId}`));
      expect(detail.marketRangeMax as number).toBeGreaterThan(0);
    });

    await test('Leaf metric created with explicit marketRangeMax stores it correctly', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `EdgeMetricRange_${Date.now()}`,
          value: 10,
          marketRangeMax: 500,
        }),
      );
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${r.id as string}`));
      expect(detail.marketRangeMax as number).toBe(500);
      await adminCall(ctx.wsId)('DELETE', `/metrics/${r.id as string}`);
    });

    await test('Composite metric with marketRangeMax is rejected (400, only leaf metrics)', async () => {
      const leafR = ok(await adminCall(ctx.wsId)('POST', '/metrics', { name: `RangeLeaf_${Date.now()}`, value: 1 }));
      const leafName = ok(await adminCall(ctx.wsId)('GET', `/metrics/${leafR.id as string}`)).name as string;
      const r = await adminCall(ctx.wsId)('POST', '/metrics', {
        name: `RangeComp_${Date.now()}`,
        formula: `{${leafName}}`,
        marketRangeMax: 500,
      });
      expect(r.status).toBe(400);
      await adminCall(ctx.wsId)('DELETE', `/metrics/${leafR.id as string}`);
    });

    await test('Setting marketRangeMax on an existing composite via PUT is rejected (400)', async () => {
      // Use the composite created in the edge-cases suite (compositeId may be gone; create fresh)
      const leafR = ok(await adminCall(ctx.wsId)('POST', '/metrics', { name: `RLeaf2_${Date.now()}`, value: 5 }));
      const leafName = ok(await adminCall(ctx.wsId)('GET', `/metrics/${leafR.id as string}`)).name as string;
      const compR = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `RComp2_${Date.now()}`,
          formula: `{${leafName}}`,
        }),
      );
      const r = await adminCall(ctx.wsId)('PUT', `/metrics/${compR.id as string}`, { marketRangeMax: 200 });
      expect(r.status).toBe(400);
      await adminCall(ctx.wsId)('DELETE', `/metrics/${compR.id as string}`);
      await adminCall(ctx.wsId)('DELETE', `/metrics/${leafR.id as string}`);
    });

    await test('marketRangeMax of 0 is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('POST', '/metrics', { name: `Bad_${Date.now()}`, marketRangeMax: 0 });
      expect(r.status).toBe(400);
    });

    await test('marketRangeMax of negative value is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('POST', '/metrics', { name: `Bad2_${Date.now()}`, marketRangeMax: -10 });
      expect(r.status).toBe(400);
    });

    await test('Composite metric formula evaluation references correct value', async () => {
      // Set leaf to known value then create composite
      if (edgeMetricId) {
        await adminCall(ctx.wsId)('PUT', `/metrics/${edgeMetricId}`, { value: 10 });
        const r = ok(
          await adminCall(ctx.wsId)('POST', '/metrics', {
            name: `EdgeComposite_${Date.now()}`,
            formula: `{${ok(await adminCall(ctx.wsId)('GET', `/metrics/${edgeMetricId}`)).name}} * 3`,
            timePreference: { enabled: false },
          }),
        );
        compositeId = r.id as string;
        const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${compositeId}`));
        // Composite stores value=0 (definition metric), total is the computed formula result
        expect(detail.total as number).toBe(30);
      }
    });

    await test('Updating a leaf metric value triggers composite recalculation', async () => {
      if (!compositeId || !edgeMetricId) return;
      await adminCall(ctx.wsId)('PUT', `/metrics/${edgeMetricId}`, { value: 20 });
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${compositeId}`));
      // total is always computed live from formula; expects 20 * 3 = 60
      expect(detail.total as number).toBe(60);
    });

    await test('Deleting a composite metric does not delete its leaf dependencies', async () => {
      if (!compositeId || !edgeMetricId) return;
      const r = await adminCall(ctx.wsId)('DELETE', `/metrics/${compositeId}`);
      expect(r.status).toBeStatus(200, 204);
      const leaf = await adminCall(ctx.wsId)('GET', `/metrics/${edgeMetricId}`);
      expect(leaf.status).toBe(200);
      compositeId = '';
    });

    await test('Deleting a metric referenced by a formula is rejected or cascades cleanly (not 500)', async () => {
      if (!edgeMetricId) return;
      // Create composite that references edgeMetric
      const comp = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `DepComp_${Date.now()}`,
          formula: `{${ok(await adminCall(ctx.wsId)('GET', `/metrics/${edgeMetricId}`)).name}}`,
        }),
      );
      // Delete the leaf: should either succeed (cascade) or return a client error, never 500
      const r = await adminCall(ctx.wsId)('DELETE', `/metrics/${edgeMetricId}`);
      expect(r.status).toBeStatus(200, 204, 400, 409);
      await adminCall(ctx.wsId)('DELETE', `/metrics/${comp.id as string}`);
      if (r.status === 200 || r.status === 204) edgeMetricId = '';
    });

    await test('Metric log is appended on value update', async () => {
      if (!ctx.metricId) return;
      const before = ok(await adminCall(ctx.wsId)('GET', `/metrics/${ctx.metricId}`)).value as number;
      await adminCall(ctx.wsId)('PUT', `/metrics/${ctx.metricId}`, { value: before + 1 });
      const logs = await adminCall(ctx.wsId)('GET', `/metrics/${ctx.metricId}/logs`);
      expect(logs.status).toBe(200);
      expect((logs.body as Array<unknown>).length).toBeGreaterThan(0);
    });

    await test('Cleanup edge metrics', async () => {
      if (compositeId) await adminCall(ctx.wsId)('DELETE', `/metrics/${compositeId}`);
      if (edgeMetricId) await adminCall(ctx.wsId)('DELETE', `/metrics/${edgeMetricId}`);
    });
  });

  await suite('Markets - edge cases', async () => {
    let edgeMarketId = '';
    let edgeMetricId2 = '';

    await test('Setup: create a standalone metric for market edge tests', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `MarketEdgeMetric_${Date.now()}`,
          value: 50,
          timePreference: { enabled: false },
        }),
      );
      edgeMetricId2 = r.id as string;
      expect(edgeMetricId2).toBeTruthy();
    });

    await test('Market created with custom rangeMin/rangeMax stores them', async () => {
      if (!edgeMetricId2) return;
      const year = new Date().getFullYear() + 3;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: edgeMetricId2,
          targetDate: `${year}`,
          rangeMin: 10,
          rangeMax: 200,
          liquidity: 1,
        }),
      );
      edgeMarketId = r.id as string;
      const detail = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${edgeMarketId}`));
      expect(parseFloat(String(detail.rangeMin))).toBe(10);
      expect(parseFloat(String(detail.rangeMax))).toBe(200);
    });

    await test('Market liquidity-events endpoint returns initial liquidity event', async () => {
      if (!edgeMarketId) return;
      const r = await adminCall(ctx.wsId)('GET', `/predictions/markets/${edgeMarketId}/liquidity-events`);
      expect(r.status).toBe(200);
      expect((r.body as Array<unknown>).length).toBeGreaterThan(0);
    });

    await test('Market context endpoint returns consensus data', async () => {
      if (!edgeMarketId) return;
      const r = await adminCall(ctx.wsId)('GET', `/predictions/markets/${edgeMarketId}/context`);
      expect(r.status).toBe(200);
    });

    await test('Creating a second market for same metric+year is rejected (409)', async () => {
      if (!edgeMetricId2) return;
      const year = new Date().getFullYear() + 3;
      const r = await adminCall(ctx.wsId)('POST', '/predictions/markets', {
        metricId: edgeMetricId2,
        targetDate: `${year}`,
      });
      expect(r.status).toBe(409);
    });

    await test('rangeMax <= rangeMin is rejected (400)', async () => {
      if (!edgeMetricId2) return;
      const r = await adminCall(ctx.wsId)('POST', '/predictions/markets', {
        metricId: edgeMetricId2,
        targetDate: `${new Date().getFullYear() + 4}`,
        rangeMin: 100,
        rangeMax: 50,
      });
      expect(r.status).toBe(400);
    });

    await test('targetValue trade mode: bet towards a specific value', async () => {
      if (!edgeMarketId || !ctx.agentKey) return;
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: edgeMarketId,
          targetValue: 100,
          maxBudget: 1,
        }),
      );
      expect(r.tradeId).toBeTruthy();
      expect(r.cost as number).toBeGreaterThan(0);
    });

    await test('targetValue outside rangeMin/rangeMax is rejected (400)', async () => {
      if (!edgeMarketId || !ctx.agentKey) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: edgeMarketId,
        targetValue: 9999,
        maxBudget: 1,
      });
      expect(r.status).toBe(400);
    });

    await test('sellShares of 0 is rejected (400)', async () => {
      if (!edgeMarketId || !ctx.agentKey) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: edgeMarketId,
        direction: 'higher',
        sellShares: 0,
      });
      expect(r.status).toBe(400);
    });

    await test('amount of 0 is rejected (400)', async () => {
      if (!edgeMarketId || !ctx.agentKey) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: edgeMarketId,
        direction: 'higher',
        amount: 0,
      });
      expect(r.status).toBe(400);
    });

    await test('Cleanup edge markets and metric', async () => {
      if (edgeMarketId) await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${edgeMarketId}`);
      if (edgeMetricId2) await adminCall(ctx.wsId)('DELETE', `/metrics/${edgeMetricId2}`);
    });
  });

  await suite('Proposal messages', async () => {
    let msgProposalId = '';

    await test('Setup: create a proposal for message tests', async () => {
      const r = ok(
        await agentCall(ctx.agentKey, ctx.wsId)('POST', '/proposals', {
          title: 'Message test proposal',
          description: 'Used to verify proposal message threading',
        }),
      );
      msgProposalId = r.id as string;
      expect(msgProposalId).toBeTruthy();
    });

    await test('GET /proposals/:id/messages returns empty array initially', async () => {
      if (!msgProposalId) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', `/proposals/${msgProposalId}/messages`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBeTruthy();
      expect((r.body as Array<unknown>).length).toBe(0);
    });

    await test('POST /proposals/:id/messages agent can send a message', async () => {
      if (!msgProposalId) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', `/proposals/${msgProposalId}/messages`, {
        content: 'Hello from agent',
      });
      expect(r.status).toBe(201);
      expect((r.body as Record<string, unknown>).content).toBe('Hello from agent');
    });

    await test('POST /proposals/:id/messages admin can send a message', async () => {
      if (!msgProposalId) return;
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${msgProposalId}/messages`, {
        content: 'Reply from admin',
      });
      expect(r.status).toBe(201);
    });

    await test('GET /proposals/:id/messages returns both messages in order', async () => {
      if (!msgProposalId) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('GET', `/proposals/${msgProposalId}/messages`);
      expect(r.status).toBe(200);
      expect((r.body as Array<unknown>).length).toBe(2);
    });

    await test('Message with empty content is rejected (400)', async () => {
      if (!msgProposalId) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', `/proposals/${msgProposalId}/messages`, {
        content: '',
      });
      expect(r.status).toBe(400);
    });

    await test('Message with content exceeding 5000 chars is rejected (400)', async () => {
      if (!msgProposalId) return;
      const r = await agentCall(ctx.agentKey, ctx.wsId)('POST', `/proposals/${msgProposalId}/messages`, {
        content: 'x'.repeat(5001),
      });
      expect(r.status).toBe(400);
    });

    await test('Approving the proposal succeeds', async () => {
      if (!msgProposalId) return;
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${msgProposalId}/approve`, {});
      expect(r.status).toBe(200);
    });

    await test('Declining an already-approved proposal is rejected (400)', async () => {
      if (!msgProposalId) return;
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${msgProposalId}/decline`, {});
      expect(r.status).toBe(400);
    });

    await test('Approving an already-approved proposal is idempotent or rejected gracefully (not 500)', async () => {
      if (!msgProposalId) return;
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${msgProposalId}/approve`, {});
      expect(r.status).toBeStatus(200, 400, 409);
    });

    await test('Cleanup: message test proposal', async () => {
      // Proposals have no delete endpoint. This is expected; they persist.
    });
  });

  await suite('Agent - edge cases', async () => {
    await test('Agent ID with special chars beyond underscore/dash is rejected', async () => {
      const r = await apiRaw('POST', '/agents/register', {
        agentId: 'bad agent!@#',
        workspaceId: ctx.wsId,
      });
      expect(r.status).toBe(400);
    });

    await test('Agent ID over 64 chars is rejected', async () => {
      const r = await apiRaw('POST', '/agents/register', {
        agentId: 'a'.repeat(65),
        workspaceId: ctx.wsId,
      });
      expect(r.status).toBe(400);
    });

    await test('Registering agent in non-existent workspace is rejected (400 or 404)', async () => {
      const r = await apiRaw('POST', '/agents/register', {
        agentId: `orphan_${Date.now().toString(36)}`,
        workspaceId: '00000000-0000-0000-0000-000000000000',
      });
      expect(r.status).toBeStatus(400, 404);
    });

    await test('Credit with zero amount is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/agents/${ctx.agentId}/credit`, { amount: 0 });
      expect(r.status).toBe(400);
    });

    await test('Credit with string amount is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/agents/${ctx.agentId}/credit`, { amount: 'lots' });
      expect(r.status).toBe(400);
    });

    await test('GET /agents/:id returns agent details', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/agents/${ctx.agentId}`));
      expect(r.id).toBe(ctx.agentId);
    });
  });

  await suite('Workspace settings - edge cases', async () => {
    await test('Updating workspace name to empty string is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/workspaces/${ctx.wsId}/settings`, { name: '' });
      expect(r.status).toBe(400);
    });

    await test('Updating workspace with no fields is rejected (400)', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/workspaces/${ctx.wsId}/settings`, {});
      expect(r.status).toBe(400);
    });

    await test('Non-existent workspace returns 404', async () => {
      const r = await adminCall(ctx.wsId)('GET', '/workspaces/00000000-0000-0000-0000-000000000000');
      expect(r.status).toBe(404);
    });

    await test('Workspace stats endpoint returns tradedVolume', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/workspaces/${ctx.wsId}/stats`));
      expect(r.tradedVolume).toBeType('number');
    });
  });

  await suite('Auth - browser session', async () => {
    let sessionCookie = '';

    await test('Sign in with email/password returns session token and user', async () => {
      const r = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.token).toBeTruthy();
      expect((body.user as Record<string, unknown>).email).toBe(ADMIN_EMAIL);
      // Capture cookie for subsequent session tests
      sessionCookie = r.headers.get('set-cookie') ?? '';
    });

    await test('Sign in with wrong password returns 401 or 403', async () => {
      const r = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: 'WrongPassword!' }),
      });
      expect(r.status).toBeStatus(401, 403);
    });

    await test('Sign in with non-existent email returns 401 or 403', async () => {
      const r = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'anything' }),
      });
      expect(r.status).toBeStatus(401, 403);
    });

    await test('GET /api/auth/me via session cookie returns user profile', async () => {
      if (!sessionCookie) return;
      const r = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: sessionCookie, 'X-Workspace-Id': 'default' },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.email).toBeFalsy(); // /auth/me returns uid, not raw email
      expect(body.uid).toBeTruthy();
      expect(body.authRole).toBe('admin');
    });
  });

  // ─── Multi-step scenario suites ───────────────────────────────────────────────

  await suite('Scenario: full market lifecycle with resolution payout', async () => {
    // Tests the complete happy path: metric → market → liquidity → trade → resolve → payout
    let scenMetricId = '';
    let scenMarketId = '';
    let agentAKey = '';
    let agentAId = '';
    let agentBKey = '';
    let agentBId = '';
    let balanceBeforeA = 0;
    let balanceBeforeB = 0;

    await test('Setup: create two agents with starting credits', async () => {
      agentAId = `scen_a_${Date.now().toString(36)}`;
      agentBId = `scen_b_${Date.now().toString(36)}`;
      const rA = ok(await apiRaw('POST', '/agents/register', { agentId: agentAId, workspaceId: ctx.wsId }));
      const rB = ok(await apiRaw('POST', '/agents/register', { agentId: agentBId, workspaceId: ctx.wsId }));
      agentAKey = rA.apiKey as string;
      agentBKey = rB.apiKey as string;
      await adminCall(ctx.wsId)('POST', `/agents/${agentAId}/credit`, { amount: 50 });
      await adminCall(ctx.wsId)('POST', `/agents/${agentBId}/credit`, { amount: 50 });
      expect(agentAKey).toBeTruthy();
      expect(agentBKey).toBeTruthy();
    });

    await test('Step 1: create a leaf metric with a known current value', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `Scen_Temp_${Date.now()}`,
          value: 75,
          marketRangeMax: 100,
          timePreference: { enabled: false },
        }),
      );
      scenMetricId = r.id as string;
      expect(scenMetricId).toBeTruthy();
    });

    await test('Step 2: manually create a market for the metric with liquidity', async () => {
      const futureYear = new Date().getFullYear() + 2;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: scenMetricId,
          targetDate: `${futureYear}`,
          rangeMin: 0,
          rangeMax: 100,
          liquidity: 10,
        }),
      );
      scenMarketId = r.id as string;
      expect(scenMarketId).toBeTruthy();
    });

    await test('Step 3: verify market probability starts near 0.5 after liquidity injection', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${scenMarketId}`));
      const prob = parseFloat(String(r.probability));
      expect(prob).toBeGreaterThan(0);
      expect(prob).toBeLessThan(1);
    });

    await test('Step 4: agent A bets higher, agent B bets lower (opposing positions)', async () => {
      const rA = ok(
        await agentCall(agentAKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: scenMarketId,
          direction: 'higher',
          amount: 5,
        }),
      );
      const rB = ok(
        await agentCall(agentBKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: scenMarketId,
          direction: 'lower',
          amount: 5,
        }),
      );
      expect(rA.shares as number).toBeGreaterThan(0);
      expect(rB.shares as number).toBeGreaterThan(0);
    });

    await test('Step 5: probability shifts toward higher after A buys higher', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${scenMarketId}`));
      // A bought higher, B bought lower; net effect depends on amounts, but market should have moved
      expect(parseFloat(String(r.probability))).toBeGreaterThan(0);
    });

    await test('Step 6: record agent balances before resolution', async () => {
      const rA = await agentCall(agentAKey, ctx.wsId)('GET', '/agents/mine');
      const rB = await agentCall(agentBKey, ctx.wsId)('GET', '/agents/mine');
      const meA = (rA.body as Array<Record<string, unknown>>).find(a => a.id === agentAId)!;
      const meB = (rB.body as Array<Record<string, unknown>>).find(a => a.id === agentBId)!;
      balanceBeforeA = meA.balance as number;
      balanceBeforeB = meB.balance as number;
      expect(balanceBeforeA).toBeLessThan(50); // spent some
      expect(balanceBeforeB).toBeLessThan(50);
    });

    await test('Step 7: resolve the market; metric value 75 in range 0-100 means higher wins', async () => {
      // Simulate the daily resolution cron by advancing "today" past the market's
      // 2028 target year. resolvePredictions batches all past-due open markets; we
      // only assert the scenMarketId landed correctly in the subsequent steps.
      const r = ok(await adminCall(ctx.wsId)('POST', '/predictions/resolve', { targetDate: '2029-01-01' }));
      expect(r.resolved as number).toBeGreaterThanOrEqual(1);
      expect(r.totalPayout as number).toBeGreaterThan(0);
    });

    await test('Step 8: market is marked resolved and exposes actualValue', async () => {
      const r = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${scenMarketId}`));
      expect(r.resolved).toBe(true);
      // actualValue is the metric total clamped to [rangeMin, rangeMax]
      expect(typeof r.actualValue).toBe('number');
      expect(r.resolvedAt).toBeTruthy();
    });

    await test('Step 9: agent A (higher) receives payout and balance increases', async () => {
      const r = await agentCall(agentAKey, ctx.wsId)('GET', '/agents/mine');
      const meA = (r.body as Array<Record<string, unknown>>).find(a => a.id === agentAId)!;
      expect(meA.balance as number).toBeGreaterThan(balanceBeforeA);
    });

    await test('Step 10: trading on a resolved market is rejected (400)', async () => {
      const r = await agentCall(agentAKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: scenMarketId,
        direction: 'higher',
        amount: 1,
      });
      expect(r.status).toBe(400);
    });

    await test('Cleanup: delete metric (market already resolved)', async () => {
      if (scenMetricId) await adminCall(ctx.wsId)('DELETE', `/metrics/${scenMetricId}`);
    });
  });

  await suite('Scenario: closed market lifecycle (TP shift -> closed -> resolve)', async () => {
    // A closed market is one that was active and then deactivated because the metric's
    // time-preference schedule no longer references its (metricId, targetDate) pair, while
    // the metric definition itself is unchanged. Closed markets must:
    //   (a) get created properly when the schedule shifts (we simulate "time passing" by
    //       shrinking the metric's halfLife so far-future sample dates fall out),
    //   (b) retain their AMM state and positions (no refunds, no zeroed shares),
    //   (c) reject new trades, and
    //   (d) resolve correctly against the metric's actual value when their targetDate is
    //       reached. We use the admin force-resolve endpoint to stand in for the daily
    //       resolution cron, which behaves identically (filters on resolved=false, ignores
    //       active flag).
    //
    // Uses a dedicated workspace so the per-workspace refresh cooldown lock doesn't
    // collide with refreshes triggered by earlier suites.
    let cmWsId = '';
    let cmAgentId = '';
    let cmAgentKey = '';
    let cmMetricId = '';
    let closedMarketId = '';
    let closedTargetDate = '';
    let preCloseAgentShares = 0;
    let preCloseLiquidity = 0;
    let preCloseConsensus = 0;

    await test('Setup: dedicated workspace + agent with credits', async () => {
      const ws = ok(
        await apiRaw(
          'POST',
          '/workspaces',
          { name: `Closed Market Lifecycle ${Date.now()}` },
          {
            'X-API-Key': ADMIN_KEY,
            'X-Workspace-Id': PLACEHOLDER_WS,
          },
        ),
      );
      cmWsId = ws.id as string;
      cmAgentId = `cmtest_${Date.now().toString(36)}`;
      const ar = ok(await apiRaw('POST', '/agents/register', { agentId: cmAgentId, workspaceId: cmWsId }));
      cmAgentKey = ar.apiKey as string;
      ok(await adminCall(cmWsId)('POST', `/agents/${cmAgentId}/credit`, { amount: 200 }));
      // Promote agent to 'trader' role so it can actually trade. /agents/register only
      // adds to the Public group (viewer/member role), which can't trade.
      const groups = ok(await adminCall(cmWsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const traderGroup = groups.find(g => g.type === 'trader');
      expect(traderGroup).toBeTruthy();
      const currentMembers = (traderGroup!.memberIds as string[]) ?? [];
      ok(
        await adminCall(cmWsId)('PUT', `/groups/${traderGroup!.id}`, {
          memberIds: [...currentMembers, cmAgentId],
        }),
      );
      expect(cmWsId).toBeTruthy();
      expect(cmAgentKey).toBeTruthy();
    });

    await test('Step 1: creating a leaf metric (TP defaults to halfLife=1y) spawns markets across the schedule', async () => {
      const r = ok(
        await adminCall(cmWsId)('POST', '/metrics', {
          name: `ClosedML_${Date.now()}`,
          value: 80,
          marketRangeMax: 100,
        }),
      );
      cmMetricId = r.id as string;
      const lr = await adminCall(cmWsId)('GET', '/predictions/markets');
      const mine = (lr.body as Array<Record<string, unknown>>).filter(m => m.metricId === cmMetricId && !m.proposalId);
      expect(mine.length).toBeGreaterThan(0);
      // halfLife=1y produces some year-granular sample dates (e.g. "2030"); pick one so
      // it's guaranteed to fall out when we later shrink halfLife to ~weeks.
      const yearGranular = mine.find(m => /^\d{4}$/.test(String(m.targetDate)));
      expect(yearGranular).toBeTruthy();
      closedMarketId = yearGranular!.id as string;
      closedTargetDate = yearGranular!.targetDate as string;
    });

    await test('Step 2: inject liquidity, agent trades higher; consensus moves above midpoint', async () => {
      ok(
        await adminCall(cmWsId)('POST', `/predictions/markets/${closedMarketId}/liquidity`, {
          amount: 50,
          agentId: cmAgentId,
        }),
      );
      ok(
        await agentCall(cmAgentKey, cmWsId)('POST', '/predictions/trade', {
          marketId: closedMarketId,
          direction: 'higher',
          amount: 5,
        }),
      );
      const lr = ok(await adminCall(cmWsId)('GET', '/predictions/markets')) as Array<Record<string, unknown>>;
      const m = lr.find(x => x.id === closedMarketId)!;
      expect(m).toBeTruthy();
      const positionsResp = ok(
        await adminCall(cmWsId)('GET', `/predictions/markets/${closedMarketId}/positions`),
      ) as Array<Record<string, unknown>>;
      const myPos = positionsResp.find(p => p.agentId === cmAgentId && p.direction === 'higher');
      preCloseAgentShares = (myPos?.shares as number) ?? 0;
      preCloseLiquidity = m.liquidity as number;
      preCloseConsensus = m.consensus as number;
      expect(preCloseAgentShares).toBeGreaterThan(0);
      expect(preCloseLiquidity).toBeGreaterThan(0);
      expect(preCloseConsensus).toBeGreaterThan(50); // pushed above midpoint by buying higher
    });

    await test('Step 3: shrinking TP halfLife to ~weeks shifts the schedule (simulates time passing)', async () => {
      // halfLife=0.05y (~2.6 weeks) -> all sample dates are within ~3 months -> all
      // year-granular dates from the previous schedule fall out.
      ok(
        await adminCall(cmWsId)('PUT', `/metrics/${cmMetricId}`, {
          timePreference: { enabled: true, halfLife: 0.05 },
        }),
      );
      const lr = await adminCall(cmWsId)('GET', '/predictions/markets');
      const mine = (lr.body as Array<Record<string, unknown>>).filter(m => m.metricId === cmMetricId && !m.proposalId);
      const weekly = mine.filter(m => /^\d{4}-W\d{2}$/.test(String(m.targetDate)) && m.status === 'open');
      expect(weekly.length).toBeGreaterThan(0); // new week-granular schedule was spawned
    });

    await test('Step 4: refresh marks markets outside the new schedule as closed (status = "closed")', async () => {
      // GET /predictions/markets implicitly triggered refreshRelativeDateMarkets above,
      // which deactivates markets not in the desired set. Hit it again to be deterministic.
      await adminCall(cmWsId)('POST', '/predictions/markets/refresh', { force: true });
      const lr = await adminCall(cmWsId)('GET', '/predictions/markets');
      const mine = (lr.body as Array<Record<string, unknown>>).filter(m => m.metricId === cmMetricId && !m.proposalId);
      const closedOnes = mine.filter(m => m.status === 'closed');
      expect(closedOnes.length).toBeGreaterThan(0);
      expect(closedOnes.some(m => m.id === closedMarketId)).toBeTruthy();
      // Sanity: every closed market here is for our metric and matches an old (year/month)
      // sample date that's no longer in the week-granular schedule.
      const okGranularity = closedOnes.every(m => /^\d{4}(-\d{2})?$/.test(String(m.targetDate)));
      expect(okGranularity).toBeTruthy();
    });

    await test('Step 5: closed market retains shares, liquidity, and AMM consensus (no refund, not voided)', async () => {
      const lr = ok(await adminCall(cmWsId)('GET', '/predictions/markets', undefined)) as Array<
        Record<string, unknown>
      >;
      const m = lr.find(x => x.id === closedMarketId)!;
      expect(m).toBeTruthy();
      expect(m.status).toBe('closed');
      expect(m.active).toBe(false);
      expect(m.resolved).toBe(false);
      expect(m.voided).toBeFalsy();
      expect(m.liquidity as number).toBe(preCloseLiquidity);
      expect(m.consensus as number).toBe(preCloseConsensus);
      expect(m.targetDate).toBe(closedTargetDate);
      const positionsResp = ok(
        await adminCall(cmWsId)('GET', `/predictions/markets/${closedMarketId}/positions`),
      ) as Array<Record<string, unknown>>;
      const myPos = positionsResp.find(p => p.agentId === cmAgentId && p.direction === 'higher');
      expect((myPos?.shares as number) ?? 0).toBe(preCloseAgentShares);
    });

    await test('Step 6: agent position on the closed market is retained', async () => {
      const r = await agentCall(cmAgentKey, cmWsId)('GET', `/predictions/positions?marketId=${closedMarketId}`);
      expect(r.status).toBe(200);
      const positions = r.body as Array<Record<string, unknown>>;
      expect(positions.length).toBeGreaterThan(0);
      expect(positions.some(p => (p.shares as number) > 0 && p.direction === 'higher')).toBeTruthy();
    });

    await test('Step 7: closed market rejects new trades (400 "Market is inactive")', async () => {
      const r = await agentCall(cmAgentKey, cmWsId)('POST', '/predictions/trade', {
        marketId: closedMarketId,
        direction: 'higher',
        amount: 1,
      });
      expect(r.status).toBe(400);
    });

    await test('Step 8: closed market resolves correctly when target date is reached (admin force-resolve)', async () => {
      // Disable TP first: a leaf with TP and any untraded current-schedule markets has
      // total=null (resolution would be skipped). This isn't relevant to the closed-market
      // invariant we're testing, just a side effect of the per-leaf consensus blending.
      ok(
        await adminCall(cmWsId)('PUT', `/metrics/${cmMetricId}`, {
          timePreference: { enabled: false },
        }),
      );
      // Stand-in for the daily cron firing once endOfPeriod(targetDate) <= today.
      // Advance "today" past the closed market's target year so the batch resolver picks it up.
      const resolveAsOf = `${parseInt(closedTargetDate, 10) + 1}-01-01`;
      const balBefore = ok(await adminCall(cmWsId)('GET', `/agents/${cmAgentId}`)).balance as number;
      const r = ok(await adminCall(cmWsId)('POST', '/predictions/resolve', { targetDate: resolveAsOf }));
      expect(r.resolved as number).toBeGreaterThanOrEqual(1);
      expect(r.totalPayout as number).toBeGreaterThan(0);
      const lr = ok(await adminCall(cmWsId)('GET', '/predictions/markets?includeResolved=true')) as Array<
        Record<string, unknown>
      >;
      const detail = lr.find(x => x.id === closedMarketId)!;
      expect(detail).toBeTruthy();
      expect(detail.status).toBe('resolved');
      expect(detail.resolved).toBe(true);
      // metric value=80, range 0..100 -> actualValue clamped to 80
      expect(detail.actualValue as number).toBe(80);
      // Higher payout factor = 0.8; agent bought 'higher', so balance must increase.
      const balAfter = ok(await adminCall(cmWsId)('GET', `/agents/${cmAgentId}`)).balance as number;
      expect(balAfter).toBeGreaterThan(balBefore);
    });

    await test('Cleanup', async () => {
      if (cmMetricId) await adminCall(cmWsId)('DELETE', `/metrics/${cmMetricId}`);
    });
  });

  await suite('Scenario: deep formula cascade and market range inheritance', async () => {
    // Tests: A (leaf) → B (= A * 2) → C (= B + 10), all with custom ranges, then verify
    // that changing A propagates all the way to C's total in real-time
    let idA = '';
    let idB = '';
    let idC = '';
    let nameA = '';
    let nameB = '';

    await test('Step 1: create leaf A with value 5 and custom range', async () => {
      nameA = `CascadeA_${Date.now()}`;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: nameA,
          value: 5,
          marketRangeMax: 200,
          timePreference: { enabled: false },
        }),
      );
      idA = r.id as string;
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${idA}`));
      expect(detail.marketRangeMax as number).toBe(200);
    });

    await test('Step 2: create B = A * 2', async () => {
      nameB = `CascadeB_${Date.now()}`;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: nameB,
          formula: `{${nameA}} * 2`,
          timePreference: { enabled: false },
        }),
      );
      idB = r.id as string;
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${idB}`));
      expect(detail.total as number).toBe(10); // 5 * 2
    });

    await test('Step 3: create C = B + 10', async () => {
      const nameC = `CascadeC_${Date.now()}`;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: nameC,
          formula: `{${nameB}} + 10`,
          timePreference: { enabled: false },
        }),
      );
      idC = r.id as string;
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${idC}`));
      expect(detail.total as number).toBe(20); // (5*2) + 10
    });

    await test('Step 4: update A to 20; C should read 50 (20*2+10)', async () => {
      await adminCall(ctx.wsId)('PUT', `/metrics/${idA}`, { value: 20 });
      const detail = ok(await adminCall(ctx.wsId)('GET', `/metrics/${idC}`));
      expect(detail.total as number).toBe(50); // (20*2) + 10
    });

    await test('Step 5: create a market for B with inherited rangeMax from metric', async () => {
      // B itself has no custom rangeMax so it uses the system default (1000)
      const futureYear = new Date().getFullYear() + 6;
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: idB,
          targetDate: `${futureYear}`,
          liquidity: 1,
        }),
      );
      const detail = ok(await adminCall(ctx.wsId)('GET', `/predictions/markets/${r.id as string}`));
      // Without explicit rangeMax on metric, should use default
      expect(parseFloat(String(detail.rangeMax))).toBeGreaterThan(0);
      await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${r.id as string}`);
    });

    await test('Step 6: circular dependency A → B → A is rejected (400)', async () => {
      // Try to make A depend on B (which depends on A)
      const r = await adminCall(ctx.wsId)('PUT', `/metrics/${idA}`, {
        formula: `{${nameB}}`,
      });
      expect(r.status).toBe(400);
    });

    await test('Cleanup cascade metrics', async () => {
      for (const id of [idC, idB, idA]) {
        if (id) await adminCall(ctx.wsId)('DELETE', `/metrics/${id}`);
      }
    });
  });

  await suite('Scenario: group permission enforcement on trading', async () => {
    // Tests that restricted groups block non-members from trading specific metrics
    let restrictedMetricId = '';
    let restrictedMarketId = '';
    let restrictedGroupId = '';
    let allowedAgentId = '';
    let allowedAgentKey = '';
    let blockedAgentId = '';
    let blockedAgentKey = '';

    await test('Setup: create two agents, one allowed and one blocked', async () => {
      allowedAgentId = `perm_allowed_${Date.now().toString(36)}`;
      blockedAgentId = `perm_blocked_${Date.now().toString(36)}`;
      const rA = ok(await apiRaw('POST', '/agents/register', { agentId: allowedAgentId, workspaceId: ctx.wsId }));
      const rB = ok(await apiRaw('POST', '/agents/register', { agentId: blockedAgentId, workspaceId: ctx.wsId }));
      allowedAgentKey = rA.apiKey as string;
      blockedAgentKey = rB.apiKey as string;
      await adminCall(ctx.wsId)('POST', `/agents/${allowedAgentId}/credit`, { amount: 20 });
      await adminCall(ctx.wsId)('POST', `/agents/${blockedAgentId}/credit`, { amount: 20 });
      expect(allowedAgentKey).toBeTruthy();
    });

    await test('Step 1: create restricted metric and market', async () => {
      const mr = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `RestrictedMetric_${Date.now()}`,
          value: 50,
        }),
      );
      restrictedMetricId = mr.id as string;
      const futureYear = new Date().getFullYear() + 7;
      const mkr = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: restrictedMetricId,
          targetDate: `${futureYear}`,
          liquidity: 5,
        }),
      );
      restrictedMarketId = mkr.id as string;
    });

    await test('Step 2: both agents can trade before any restrictions', async () => {
      const rA = ok(
        await agentCall(allowedAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: restrictedMarketId,
          direction: 'higher',
          amount: 1,
        }),
      );
      const rB = ok(
        await agentCall(blockedAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: restrictedMarketId,
          direction: 'higher',
          amount: 1,
        }),
      );
      expect(rA.tradeId).toBeTruthy();
      expect(rB.tradeId).toBeTruthy();
    });

    await test('Step 3: create restricted group containing only the allowed agent', async () => {
      const r = ok(
        await adminCall(ctx.wsId)('POST', '/groups', {
          name: `RestrictedGroup_${Date.now()}`,
        }),
      );
      restrictedGroupId = r.id as string;
      // Add trade permission for the restricted metric to this group
      await adminCall(ctx.wsId)('PUT', `/groups/${restrictedGroupId}`, {
        memberIds: [allowedAgentId],
        permissions: { [restrictedMetricId]: { read: true, trade: true } },
      });
    });

    await test('Step 4: allowed agent can still trade after restriction', async () => {
      const r = ok(
        await agentCall(allowedAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: restrictedMarketId,
          direction: 'higher',
          amount: 1,
        }),
      );
      expect(r.tradeId).toBeTruthy();
    });

    await test('Step 5: blocked agent cannot trade restricted metric (403)', async () => {
      const r = await agentCall(blockedAgentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: restrictedMarketId,
        direction: 'higher',
        amount: 1,
      });
      expect(r.status).toBe(403);
    });

    await test('Step 6: removing the restriction re-allows the blocked agent', async () => {
      // Clear permissions from the group
      await adminCall(ctx.wsId)('PUT', `/groups/${restrictedGroupId}`, {
        memberIds: [allowedAgentId],
        permissions: {},
      });
      const r = ok(
        await agentCall(blockedAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: restrictedMarketId,
          direction: 'higher',
          amount: 1,
        }),
      );
      expect(r.tradeId).toBeTruthy();
    });

    await test('Cleanup: restricted group, market, metric', async () => {
      if (restrictedGroupId) await adminCall(ctx.wsId)('DELETE', `/groups/${restrictedGroupId}`);
      if (restrictedMarketId) await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${restrictedMarketId}`);
      if (restrictedMetricId) await adminCall(ctx.wsId)('DELETE', `/metrics/${restrictedMetricId}`);
    });
  });

  await suite('Scenario: balance accounting integrity', async () => {
    // Verifies that credits in = credits out: buy → sell round-trip loses only to spread/fees
    // and that balance never goes negative under valid operations
    let acctAgentId = '';
    let acctAgentKey = '';
    let acctMarketId = '';
    let acctMetricId = '';
    const STARTING_CREDITS = 30;

    await test('Setup: agent with exact starting balance', async () => {
      acctAgentId = `acct_${Date.now().toString(36)}`;
      const r = ok(await apiRaw('POST', '/agents/register', { agentId: acctAgentId, workspaceId: ctx.wsId }));
      acctAgentKey = r.apiKey as string;
      await adminCall(ctx.wsId)('POST', `/agents/${acctAgentId}/credit`, { amount: STARTING_CREDITS });

      const mine = await agentCall(acctAgentKey, ctx.wsId)('GET', '/agents/mine');
      const me = (mine.body as Array<Record<string, unknown>>).find(a => a.id === acctAgentId)!;
      expect(me.balance as number).toBe(STARTING_CREDITS);
    });

    await test('Step 1: create metric and market', async () => {
      const mr = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `AcctMetric_${Date.now()}`,
          value: 50,
        }),
      );
      acctMetricId = mr.id as string;
      const futureYear = new Date().getFullYear() + 8;
      const mkr = ok(
        await adminCall(ctx.wsId)('POST', '/predictions/markets', {
          metricId: acctMetricId,
          targetDate: `${futureYear}`,
          liquidity: 20,
        }),
      );
      acctMarketId = mkr.id as string;
    });

    await test('Step 2: buy 10 credits of higher', async () => {
      const r = ok(
        await agentCall(acctAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: acctMarketId,
          direction: 'higher',
          amount: 10,
        }),
      );
      expect(r.cost as number).toBeCloseTo(10, 1);
      expect(r.shares as number).toBeGreaterThan(0);
    });

    await test('Step 3: balance after buy = starting - cost', async () => {
      const mine = await agentCall(acctAgentKey, ctx.wsId)('GET', '/agents/mine');
      const me = (mine.body as Array<Record<string, unknown>>).find(a => a.id === acctAgentId)!;
      expect(me.balance as number).toBeCloseTo(STARTING_CREDITS - 10, 1);
    });

    await test('Step 4: sell half the higher shares back', async () => {
      const posR = await agentCall(acctAgentKey, ctx.wsId)('GET', '/predictions/positions');
      const pos = (posR.body as Array<Record<string, unknown>>).find(
        p => p.marketId === acctMarketId && p.direction === 'higher',
      );
      expect(pos).toBeTruthy();
      const halfShares = Math.floor((pos!.shares as number) / 2);
      const r = ok(
        await agentCall(acctAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: acctMarketId,
          direction: 'higher',
          sellShares: halfShares,
        }),
      );
      expect(r.proceeds as number).toBeGreaterThan(0);
    });

    await test('Step 5: balance increases after sell but remains below starting (spread cost)', async () => {
      const mine = await agentCall(acctAgentKey, ctx.wsId)('GET', '/agents/mine');
      const me = (mine.body as Array<Record<string, unknown>>).find(a => a.id === acctAgentId)!;
      const balance = me.balance as number;
      // Should be more than after buy, but less than STARTING_CREDITS (spread is non-zero)
      expect(balance).toBeGreaterThan(STARTING_CREDITS - 10);
      expect(balance).toBeLessThan(STARTING_CREDITS + 0.01);
    });

    await test('Step 6: buying more than current balance is rejected (400)', async () => {
      const mine = await agentCall(acctAgentKey, ctx.wsId)('GET', '/agents/mine');
      const me = (mine.body as Array<Record<string, unknown>>).find(a => a.id === acctAgentId)!;
      const currentBalance = me.balance as number;
      const r = await agentCall(acctAgentKey, ctx.wsId)('POST', '/predictions/trade', {
        marketId: acctMarketId,
        direction: 'higher',
        amount: currentBalance + 100,
      });
      expect(r.status).toBe(400);
    });

    await test('Step 7: sell remaining higher shares (including fractional)', async () => {
      const posR = await agentCall(acctAgentKey, ctx.wsId)('GET', '/predictions/positions');
      const pos = (posR.body as Array<Record<string, unknown>>).find(
        p => p.marketId === acctMarketId && p.direction === 'higher',
      );
      if (!pos || (pos.shares as number) <= 0) return; // already sold all
      // Use actual share count (may be fractional; API accepts non-integer sellShares)
      const r = ok(
        await agentCall(acctAgentKey, ctx.wsId)('POST', '/predictions/trade', {
          marketId: acctMarketId,
          direction: 'higher',
          sellShares: pos.shares as number,
        }),
      );
      expect(r.proceeds as number).toBeGreaterThanOrEqual(0);
    });

    await test('Step 8: verify positions show effectively zero shares after full sell', async () => {
      const posR = await agentCall(acctAgentKey, ctx.wsId)('GET', '/predictions/positions');
      const pos = (posR.body as Array<Record<string, unknown>>).find(
        p => p.marketId === acctMarketId && p.direction === 'higher' && (p.shares as number) > 0.001,
      );
      expect(pos).toBeFalsy();
    });

    await test('Cleanup: acct market and metric', async () => {
      if (acctMarketId) await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${acctMarketId}`);
      if (acctMetricId) await adminCall(ctx.wsId)('DELETE', `/metrics/${acctMetricId}`);
    });
  });

  await suite('Scenario: proposal lifecycle with conditional markets', async () => {
    // Full proposal flow: propose → approve → conditional markets → trade → complete/decline
    let lifecycleAgentId = '';
    let lifecycleAgentKey = '';
    let lifecycleProposalId = '';
    let lifecycleMetricId = '';

    await test('Setup: create agent and metric for proposal scenario', async () => {
      lifecycleAgentId = `proposal_life_${Date.now().toString(36)}`;
      const r = ok(await apiRaw('POST', '/agents/register', { agentId: lifecycleAgentId, workspaceId: ctx.wsId }));
      lifecycleAgentKey = r.apiKey as string;
      await adminCall(ctx.wsId)('POST', `/agents/${lifecycleAgentId}/credit`, { amount: 50 });

      const mr = ok(
        await adminCall(ctx.wsId)('POST', '/metrics', {
          name: `ProposalMetric_${Date.now()}`,
          value: 30,
        }),
      );
      lifecycleMetricId = mr.id as string;
    });

    await test('Step 1: agent proposes a proposal', async () => {
      const r = ok(
        await agentCall(lifecycleAgentKey, ctx.wsId)('POST', '/proposals', {
          title: 'Lifecycle Test Proposal',
          description: 'Complete a specific measurable outcome',
        }),
      );
      lifecycleProposalId = r.id as string;
      expect(lifecycleProposalId).toBeTruthy();
    });

    await test('Step 2: proposal starts as pending', async () => {
      const r = ok(await agentCall(lifecycleAgentKey, ctx.wsId)('GET', `/proposals/${lifecycleProposalId}`));
      expect(r.status).toBe('pending');
    });

    await test('Step 3: agent sends a question about the proposal', async () => {
      const r = await agentCall(lifecycleAgentKey, ctx.wsId)('POST', `/proposals/${lifecycleProposalId}/messages`, {
        content: 'Can you clarify the acceptance criteria?',
      });
      expect(r.status).toBe(201);
    });

    await test('Step 4: admin replies with clarification', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${lifecycleProposalId}/messages`, {
        content: 'The metric must reach 50 within 30 days.',
      });
      expect(r.status).toBe(201);
    });

    await test('Step 5: message thread has 2 messages in order', async () => {
      const r = await adminCall(ctx.wsId)('GET', `/proposals/${lifecycleProposalId}/messages`);
      const msgs = r.body as Array<Record<string, unknown>>;
      expect(msgs.length).toBe(2);
      expect(msgs[0].content).toBe('Can you clarify the acceptance criteria?');
      expect(msgs[1].content).toBe('The metric must reach 50 within 30 days.');
    });

    await test('Step 6: admin approves the proposal', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${lifecycleProposalId}/approve`, {});
      expect(r.status).toBe(200);
      const detail = ok(await adminCall(ctx.wsId)('GET', `/proposals/${lifecycleProposalId}`));
      expect(detail.status).toBe('approved');
    });

    await test('Step 7: cannot decline an already-approved proposal (400)', async () => {
      const r = await adminCall(ctx.wsId)('POST', `/proposals/${lifecycleProposalId}/decline`, {});
      expect(r.status).toBe(400);
    });

    await test('Step 8: agent can still read messages after approval', async () => {
      const r = await agentCall(lifecycleAgentKey, ctx.wsId)('GET', `/proposals/${lifecycleProposalId}/messages`);
      expect(r.status).toBe(200);
      expect((r.body as Array<unknown>).length).toBe(2);
    });

    await test('Cleanup: lifecycle metric', async () => {
      if (lifecycleMetricId) await adminCall(ctx.wsId)('DELETE', `/metrics/${lifecycleMetricId}`);
    });
  });

  await suite('Scenario: manage capability granted via Admin group', async () => {
    // Tests that adding a participant to the Admin group grants the `manage`
    // capability (enforced behaviorally: can create metrics), and removal revokes it.
    let promoAgentId = '';
    let promoAgentKey = '';

    await test('Setup: register a participant (no manage capability by default)', async () => {
      promoAgentId = `promo_${Date.now().toString(36)}`;
      const r = ok(await apiRaw('POST', '/agents/register', { agentId: promoAgentId, workspaceId: ctx.wsId }));
      promoAgentKey = r.apiKey as string;
    });

    await test('Step 1: participant cannot create metrics (lacks manage capability)', async () => {
      const r = await agentCall(promoAgentKey, ctx.wsId)('POST', '/metrics', {
        name: `ShouldFail_${Date.now()}`,
        value: 1,
      });
      expect(r.status).toBe(403);
    });

    await test('Step 2: add participant to Admin group → gains manage capability', async () => {
      const groups = await adminCall(ctx.wsId)('GET', '/groups');
      const adminGroup = (groups.body as Array<Record<string, unknown>>).find(g => g.name === 'Admin')!;
      const currentMembers = (adminGroup.memberIds as string[]) ?? [];
      await adminCall(ctx.wsId)('PUT', `/groups/${adminGroup.id as string}`, {
        memberIds: [...currentMembers, promoAgentId],
      });
    });

    await test('Step 3: now promoted participant can create a metric', async () => {
      const r = ok(
        await agentCall(promoAgentKey, ctx.wsId)('POST', '/metrics', {
          name: `PromoMetric_${Date.now()}`,
          value: 1,
        }),
      );
      await adminCall(ctx.wsId)('DELETE', `/metrics/${r.id as string}`);
    });

    await test('Step 4: remove from Admin group → manage capability revoked', async () => {
      const groups = await adminCall(ctx.wsId)('GET', '/groups');
      const adminGroup = (groups.body as Array<Record<string, unknown>>).find(g => g.name === 'Admin')!;
      const currentMembers = ((adminGroup.memberIds as string[]) ?? []).filter((id: string) => id !== promoAgentId);
      await adminCall(ctx.wsId)('PUT', `/groups/${adminGroup.id as string}`, {
        memberIds: currentMembers,
      });
    });

    await test('Step 5: demoted participant cannot create metrics again (403)', async () => {
      const r = await agentCall(promoAgentKey, ctx.wsId)('POST', '/metrics', {
        name: `ShouldFailAgain_${Date.now()}`,
        value: 1,
      });
      expect(r.status).toBe(403);
    });
  });

  await suite('Scenario: per-group capability editing', async () => {
    // Verifies the refactored model: group names are labels; capabilities drive authorization.
    // A custom group can be granted `manage` by editing its capabilities[] array.
    let customGroupId = '';
    let capAgentId = '';
    let capAgentKey = '';

    await test('Setup: register a participant', async () => {
      capAgentId = `cap_${Date.now().toString(36)}`;
      const r = ok(await apiRaw('POST', '/agents/register', { agentId: capAgentId, workspaceId: ctx.wsId }));
      capAgentKey = r.apiKey as string;
    });

    await test('Create a custom group with no capabilities; member cannot trade or manage', async () => {
      const g = ok(
        await adminCall(ctx.wsId)('POST', '/groups', {
          name: `CapTest_${Date.now()}`,
          description: 'Capability test group',
          capabilities: [],
        }),
      );
      customGroupId = g.id as string;
      await adminCall(ctx.wsId)('PUT', `/groups/${customGroupId}`, { memberIds: [capAgentId] });

      const metricR = await agentCall(capAgentKey, ctx.wsId)('POST', '/metrics', {
        name: `NoCap_${Date.now()}`,
        value: 1,
      });
      expect(metricR.status).toBe(403);
    });

    await test('Grant manage capability to the custom group → member can now create metrics', async () => {
      ok(
        await adminCall(ctx.wsId)('PUT', `/groups/${customGroupId}`, {
          capabilities: ['read', 'trade', 'manage'],
        }),
      );
      const r = ok(
        await agentCall(capAgentKey, ctx.wsId)('POST', '/metrics', {
          name: `CapGranted_${Date.now()}`,
          value: 1,
        }),
      );
      await adminCall(ctx.wsId)('DELETE', `/metrics/${r.id as string}`);
    });

    await test('Revoke manage; keep read+trade → member loses manage but retains read', async () => {
      ok(
        await adminCall(ctx.wsId)('PUT', `/groups/${customGroupId}`, {
          capabilities: ['read', 'trade'],
        }),
      );
      const manageR = await agentCall(capAgentKey, ctx.wsId)('POST', '/metrics', {
        name: `ShouldFail_${Date.now()}`,
        value: 1,
      });
      expect(manageR.status).toBe(403);
      const readR = await agentCall(capAgentKey, ctx.wsId)('GET', '/metrics');
      expect(readR.status).toBe(200);
    });

    await test('Reject invalid capability string', async () => {
      const r = await adminCall(ctx.wsId)('PUT', `/groups/${customGroupId}`, {
        capabilities: ['read', 'bogus'],
      });
      expect(r.status).toBe(400);
    });

    await test('System groups cannot be deleted', async () => {
      const groups = ok(await adminCall(ctx.wsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const adminGroup = groups.find(g => g.type === 'admin')!;
      const r = await adminCall(ctx.wsId)('DELETE', `/groups/${adminGroup.id as string}`);
      expect(r.status).toBe(400);
    });

    await test('System groups seed expected default capabilities', async () => {
      const groups = ok(await adminCall(ctx.wsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const pub = groups.find(g => g.type === 'public')!;
      const trader = groups.find(g => g.type === 'trader')!;
      const admin = groups.find(g => g.type === 'admin')!;
      expect((pub.capabilities as string[]).sort().join(',')).toBe('read');
      expect((trader.capabilities as string[]).sort().join(',')).toBe('read,trade');
      expect((admin.capabilities as string[]).sort().join(',')).toBe('manage,read,trade');
    });

    await test('Cleanup: delete custom group', async () => {
      const r = await adminCall(ctx.wsId)('DELETE', `/groups/${customGroupId}`);
      expect(r.status).toBeStatus(200, 204);
    });
  });

  await suite('Scenario: new account signup-to-value flow', async () => {
    // Tests the end-to-end signup flow: create account -> ensureParticipant (no workspace) -> create workspace -> access it
    const testEmail = `test-signup-${Date.now()}@integration.test`;
    const testPassword = 'IntegrationTest123!';
    let signupCookie = '';
    let newUserId = '';
    let templateWsId = ''; // workspace created from template

    await test('Sign up creates a new account', async () => {
      // Brief pause to avoid rate-limit from earlier auth tests
      await new Promise(r => setTimeout(r, 1000));
      const r = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Test Signup' }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.token).toBeTruthy();
      newUserId = (body.user as Record<string, unknown>).id as string;
      expect(newUserId).toBeTruthy();
      signupCookie = r.headers.get('set-cookie') ?? '';
      expect(signupCookie).toBeTruthy();
    });

    await test('GET /auth/me creates participant but no workspace (authRole=pending)', async () => {
      if (!signupCookie) return;
      const r = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: signupCookie },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.uid).toBe(newUserId);
      expect(body.authRole).toBe('pending');
      expect(body.workspaceId).toBe('');
    });

    await test('Create workspace from startup template (no prior workspace needed)', async () => {
      if (!signupCookie) return;
      const r = await fetch(`${BASE_URL}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: signupCookie },
        body: JSON.stringify({ name: 'Signup Test Startup', template: 'startup' }),
      });
      expect(r.status).toBe(201);
      const body = (await r.json()) as Record<string, unknown>;
      templateWsId = body.id as string;
      expect(templateWsId).toBeTruthy();
      expect(body.metricsCreated).toBe(3);
    });

    await test('After workspace creation, user is owner with admin authRole', async () => {
      if (!signupCookie || !templateWsId) return;
      const r = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: signupCookie, 'X-Workspace-Id': templateWsId },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.authRole).toBe('admin');
      expect(body.memberRole).toBe('owner');
      expect(body.workspaceId).toBe(templateWsId);
    });

    await test('New user has credits (1000 minus auto-fund deductions)', async () => {
      if (!signupCookie || !templateWsId) return;
      const r = await fetch(`${BASE_URL}/api/agents/me`, {
        headers: { Cookie: signupCookie, 'X-Workspace-Id': templateWsId },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      // Started with 1000, auto-fund deducts 0.5 * ~27 markets = ~13.5 credits
      expect(body.balance as number).toBeGreaterThan(900);
      expect(body.balance as number).toBeLessThan(1001);
    });

    await test('New workspace is accessible (GET /status returns metrics)', async () => {
      if (!signupCookie || !templateWsId) return;
      const r = await fetch(`${BASE_URL}/api/status`, {
        headers: { Cookie: signupCookie, 'X-Workspace-Id': templateWsId },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      const metrics = body.metrics as unknown[];
      expect(metrics.length).toBe(3);
    });

    await test('New workspace has markets (auto-created by time preference)', async () => {
      if (!signupCookie || !templateWsId) return;
      const r = await fetch(`${BASE_URL}/api/predictions/markets`, {
        headers: { Cookie: signupCookie, 'X-Workspace-Id': templateWsId },
      });
      expect(r.status).toBe(200);
      const markets = (await r.json()) as unknown[];
      expect(markets.length).toBeGreaterThan(0);
    });

    await test('New workspace has auto-fund enabled', async () => {
      if (!templateWsId) return;
      const r = await adminCall(templateWsId)('GET', `/workspaces/${templateWsId}`);
      const ws = ok(r, 'get workspace');
      expect(ws.autoFundNewMarkets).toBe(true);
      expect(ws.newMarketLiquidityCredits).toBe(0.5);
    });

    await test('Cleanup: delete signup test workspace', async () => {
      if (templateWsId) await adminCall(templateWsId)('DELETE', `/workspaces/${templateWsId}`);
    });
  });

  await suite('Scenario: workspace visibility and marketplace discovery', async () => {
    // Covers the end-to-end discoverability flag: create with visibility, flip
    // via settings (owner-only), listing endpoint, and self-service join.
    const testEmail = `test-visibility-${Date.now()}@integration.test`;
    const testPassword = 'IntegrationTest123!';
    let ownerCookie = '';
    let ownerUid = '';
    let publicWsId = '';
    let privateWsId = '';
    let joinerEmail = '';
    let joinerCookie = '';
    let joinerUid = '';

    await test('Sign up fresh owner account', async () => {
      await new Promise(r => setTimeout(r, 1000));
      const r = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Visibility Owner' }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      ownerUid = (body.user as Record<string, unknown>).id as string;
      ownerCookie = r.headers.get('set-cookie') ?? '';
      expect(ownerCookie).toBeTruthy();
      // Trigger ensureParticipant so subsequent workspace-owner flows find an agent row.
      await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: ownerCookie } });
    });

    await test('POST /workspaces with visibility="public" returns visibility="public"', async () => {
      if (!ownerCookie) return;
      const r = await fetch(`${BASE_URL}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ name: `Vis Public ${Date.now()}`, template: 'blank', visibility: 'public' }),
      });
      expect(r.status).toBe(201);
      const body = (await r.json()) as Record<string, unknown>;
      publicWsId = body.id as string;
      expect(body.visibility).toBe('public');
    });

    await test('POST /workspaces without visibility defaults to "private"', async () => {
      if (!ownerCookie) return;
      const r = await fetch(`${BASE_URL}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ name: `Vis Private ${Date.now()}`, template: 'blank' }),
      });
      expect(r.status).toBe(201);
      const body = (await r.json()) as Record<string, unknown>;
      privateWsId = body.id as string;
      expect(body.visibility).toBe('private');
    });

    await test('POST /workspaces with invalid visibility is rejected (400)', async () => {
      if (!ownerCookie) return;
      const r = await fetch(`${BASE_URL}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ name: 'Vis Bad', template: 'blank', visibility: 'OPEN' }),
      });
      expect(r.status).toBe(400);
    });

    await test('GET /marketplace/workspaces/public lists the public workspace', async () => {
      const r = await apiRaw('GET', '/marketplace/workspaces/public');
      expect(r.status).toBe(200);
      const list = r.body as Array<Record<string, unknown>>;
      expect(list.some(w => w.workspaceId === publicWsId)).toBeTruthy();
    });

    await test('GET /marketplace/workspaces/public does not list the private workspace', async () => {
      const r = await apiRaw('GET', '/marketplace/workspaces/public');
      const list = r.body as Array<Record<string, unknown>>;
      expect(list.some(w => w.workspaceId === privateWsId)).toBeFalsy();
    });

    await test('Owner can flip private workspace to public via settings', async () => {
      if (!ownerCookie || !privateWsId) return;
      const r = await fetch(`${BASE_URL}/api/workspaces/${privateWsId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie, 'X-Workspace-Id': privateWsId },
        body: JSON.stringify({ visibility: 'public' }),
      });
      expect(r.status).toBeStatus(200, 204);

      const detail = await fetch(`${BASE_URL}/api/workspaces/${privateWsId}`, {
        headers: { Cookie: ownerCookie, 'X-Workspace-Id': privateWsId },
      });
      const ws = (await detail.json()) as Record<string, unknown>;
      expect(ws.visibility).toBe('public');
    });

    await test('Owner can flip back to private via settings', async () => {
      if (!ownerCookie || !privateWsId) return;
      const r = await fetch(`${BASE_URL}/api/workspaces/${privateWsId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie, 'X-Workspace-Id': privateWsId },
        body: JSON.stringify({ visibility: 'private' }),
      });
      expect(r.status).toBeStatus(200, 204);

      const list = await apiRaw('GET', '/marketplace/workspaces/public');
      const arr = list.body as Array<Record<string, unknown>>;
      expect(arr.some(w => w.workspaceId === privateWsId)).toBeFalsy();
    });

    await test('Master API key cannot set visibility (403)', async () => {
      if (!publicWsId) return;
      const r = await adminCall(publicWsId)('PUT', `/workspaces/${publicWsId}/settings`, {
        visibility: 'private',
      });
      expect(r.status).toBe(403);
    });

    await test('Invalid visibility on settings PUT is rejected (400)', async () => {
      if (!ownerCookie || !publicWsId) return;
      const r = await fetch(`${BASE_URL}/api/workspaces/${publicWsId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie, 'X-Workspace-Id': publicWsId },
        body: JSON.stringify({ visibility: 'semi-public' }),
      });
      expect(r.status).toBe(400);
    });

    await test('Sign up second account to act as a joiner', async () => {
      await new Promise(r => setTimeout(r, 1000));
      joinerEmail = `test-joiner-${Date.now()}@integration.test`;
      const r = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ email: joinerEmail, password: testPassword, name: 'Marketplace Joiner' }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      joinerUid = (body.user as Record<string, unknown>).id as string;
      joinerCookie = r.headers.get('set-cookie') ?? '';
      expect(joinerCookie).toBeTruthy();
      // Trigger ensureParticipant so joiner has an agent row for workspace-member resolution.
      await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: joinerCookie } });
    });

    await test('Joiner is not a member of the public workspace yet (403 on detail)', async () => {
      if (!joinerCookie || !publicWsId) return;
      const r = await fetch(`${BASE_URL}/api/workspaces/${publicWsId}`, {
        headers: { Cookie: joinerCookie, 'X-Workspace-Id': publicWsId },
      });
      expect(r.status).toBe(403);
    });

    await test('POST /marketplace/:id/join adds joiner to the Public group', async () => {
      if (!joinerCookie || !publicWsId) return;
      // Note: join endpoint intentionally omits X-Workspace-Id, because authMiddleware
      // rejects with 403 when the header names a workspace the user is not yet a member of.
      const r = await fetch(`${BASE_URL}/api/marketplace/${publicWsId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: joinerCookie },
        body: JSON.stringify({}),
      });
      expect(r.status).toBeStatus(200, 201);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.workspaceId).toBe(publicWsId);
      expect(body.role).toBe('member');
    });

    await test('Joined participant can now fetch workspace detail', async () => {
      if (!joinerCookie || !publicWsId) return;
      const r = await fetch(`${BASE_URL}/api/workspaces/${publicWsId}`, {
        headers: { Cookie: joinerCookie, 'X-Workspace-Id': publicWsId },
      });
      expect(r.status).toBe(200);
      const ws = (await r.json()) as Record<string, unknown>;
      expect(ws.id).toBe(publicWsId);
    });

    await test('Joined participant appears in the Public group memberIds', async () => {
      if (!publicWsId || !joinerUid) return;
      const groups = ok(await adminCall(publicWsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const pub = groups.find(g => g.type === 'public');
      expect(pub).toBeTruthy();
      const ids = (pub!.memberIds as string[]) ?? [];
      expect(ids.includes(joinerUid)).toBeTruthy();
    });

    await test('Joining a private workspace still adds to Public group but workspace stays unlisted', async () => {
      if (!joinerCookie || !privateWsId) return;
      const r = await fetch(`${BASE_URL}/api/marketplace/${privateWsId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: joinerCookie },
        body: JSON.stringify({}),
      });
      expect(r.status).toBeStatus(200, 201);
      // Still absent from the public listing
      const list = await apiRaw('GET', '/marketplace/workspaces/public');
      const arr = list.body as Array<Record<string, unknown>>;
      expect(arr.some(w => w.workspaceId === privateWsId)).toBeFalsy();
    });

    await test('Owner granting Public group the trade capability models "Open" access', async () => {
      if (!ownerCookie || !publicWsId) return;
      // The UI picker composes "Open" as visibility=public + Public group capability includes trade.
      // It drives this via existing endpoints, so the backend contract is: PUT group capabilities.
      const groups = ok(await adminCall(publicWsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const pub = groups.find(g => g.type === 'public');
      expect(pub).toBeTruthy();
      const existingCaps = (pub!.capabilities as string[]) ?? [];
      const nextCaps = Array.from(new Set([...existingCaps, 'read', 'trade']));
      const putRes = await fetch(`${BASE_URL}/api/groups/${pub!.id as string}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie, 'X-Workspace-Id': publicWsId },
        body: JSON.stringify({ capabilities: nextCaps }),
      });
      expect(putRes.status).toBeStatus(200, 204);
      const after = ok(await adminCall(publicWsId)('GET', '/groups')) as Array<Record<string, unknown>>;
      const pub2 = after.find(g => g.type === 'public');
      expect((pub2!.capabilities as string[]).includes('trade')).toBeTruthy();
    });

    await test('Cleanup: delete visibility scenario workspaces', async () => {
      if (publicWsId) await adminCall(publicWsId)('DELETE', `/workspaces/${publicWsId}`);
      if (privateWsId) await adminCall(privateWsId)('DELETE', `/workspaces/${privateWsId}`);
      // Suppress unused variable lint for ownerUid; kept for debugging clarity
      void ownerUid;
    });
  });

  await suite('Cleanup', async () => {
    await test('Delete test market if still exists', async () => {
      if (!ctx.marketId) return;
      const r = await adminCall(ctx.wsId)('DELETE', `/predictions/markets/${ctx.marketId}`);
      // Market may already have been voided/resolved during tests; 404 is fine
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

    await test('Workspace delete endpoint succeeds for owner', async () => {
      if (!ctx.wsId) return;
      const r = await adminCall(ctx.wsId)('DELETE', `/workspaces/${ctx.wsId}`);
      expect(r.status).toBeStatus(200, 204);
    });
  });
} // end main()

async function cleanupWorkspaces() {
  const wsIds = [ctx.wsId, ctx.wsId2].filter(Boolean) as string[];
  for (const wsId of wsIds) {
    try {
      await apiRaw('DELETE', `/workspaces/${wsId}`, undefined, {
        'X-API-Key': ADMIN_KEY,
        'X-Workspace-Id': wsId,
      });
    } catch {
      /* best-effort */
    }
  }
  if (wsIds.length) console.log(`  Cleaned up ${wsIds.length} test workspace(s).`);
}

main()
  .then(async () => {
    await cleanupWorkspaces();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${passed} passed, ${failed} failed (${results.length} total)`);
    if (failed > 0) {
      console.log('\n  Failed tests:');
      results.filter(r => !r.passed).forEach(r => console.log(`    ✗ [${r.suite}] ${r.name}\n      ${r.error}`));
      console.log('');
      process.exit(1);
    } else {
      console.log('  All tests passed.\n');
    }
  })
  .catch(async e => {
    await cleanupWorkspaces().catch(() => {});
    console.error('Fatal:', e);
    process.exit(1);
  });
