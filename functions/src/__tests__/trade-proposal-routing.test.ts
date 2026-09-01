/**
 * HTTP-level tests for the trade route's proposalId routing.
 *
 * When a request identifies a market by metricName/metricId + targetDate,
 * the lookup needs proposalId to disambiguate between a baseline market
 * (proposalId IS NULL) and a conditional market for a specific proposal.
 *
 * Without these tests it was possible to silently route a conditional
 * trade to the baseline market, defeating the entire conditional-market
 * product surface for callers that don't have the marketId in hand.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agentApiKeys, agents, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware, hashKey } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const WS = 'ws-trade-routing';
const OWNER = 'agent-owner-r';
const BETTOR = 'agent-bettor-r';
const BETTOR_KEY = 'test-bettor-routing-raw-key';
const METRIC = 'metric-routing';
const TARGET = '2026-11';
const PROPOSAL_ID = 'proposal-x';

const BASELINE_MARKET = 'mkt-baseline';
const CONDITIONAL_MARKET = 'mkt-conditional';

const RANGE_MIN = 0;
const RANGE_MAX = 100;
const LIQUIDITY = 10;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-r', balance: toUnits(0) },
    { id: BETTOR, apiKeyHash: hashKey(BETTOR_KEY), balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Routing Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    // 'public': this suite is about TRADING, and trading needs a published
    // floor now (docs/guides/creating.md). The value used to be 'private'
    // and was incidental - nothing here tests visibility.
    visibility: 'public',
  });
  const traderRows = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const traderGroup = traderRows.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BETTOR] })
    .where(eq(permissionGroups.id, traderGroup.id));
  await db.insert(agentApiKeys).values({
    hash: hashKey(BETTOR_KEY),
    keyId: 'key-r',
    agentId: BETTOR,
    workspaceId: WS,
    label: 'test',
    scopes: ['*'],
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Routing Metric',
    value: 0,
    formula: '0',
    marketRangeMax: RANGE_MAX,
  });
  // Two markets for the same (metricId, targetDate) — one baseline, one conditional.
  await db.insert(markets).values([
    {
      id: BASELINE_MARKET,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Routing Metric',
      targetDate: TARGET,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      shares: [0, 0],
      liquidity: LIQUIDITY,
      pool: initialPool(LIQUIDITY),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    },
    {
      id: CONDITIONAL_MARKET,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Routing Metric',
      targetDate: TARGET,
      rangeMin: RANGE_MIN,
      rangeMax: RANGE_MAX,
      shares: [0, 0],
      liquidity: LIQUIDITY,
      pool: initialPool(LIQUIDITY),
      active: true,
      resolved: false,
      voided: false,
      proposalId: PROPOSAL_ID,
      branch: 'approved',
    },
  ]);
}

const post = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', BETTOR)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

describe('trade route — proposalId routing on metricId + targetDate lookup', () => {
  test('without proposalId, routes to the BASELINE market', async () => {
    await seed();
    const r = await post({ metricId: METRIC, targetDate: TARGET, targetValue: 60, maxBudget: 5 });
    expect(r.status).toBe(201);
    expect(r.body.marketId).toBe(BASELINE_MARKET);
  });

  test('with proposalId, routes to the CONDITIONAL market for that proposal', async () => {
    await seed();
    const r = await post({
      metricId: METRIC,
      targetDate: TARGET,
      proposalId: PROPOSAL_ID,
      targetValue: 60,
      maxBudget: 5,
    });
    expect(r.status).toBe(201);
    expect(r.body.marketId).toBe(CONDITIONAL_MARKET);
  });

  test('explicit null proposalId routes to baseline (same as omitted)', async () => {
    await seed();
    const r = await post({ metricId: METRIC, targetDate: TARGET, proposalId: null, targetValue: 60, maxBudget: 5 });
    expect(r.status).toBe(201);
    expect(r.body.marketId).toBe(BASELINE_MARKET);
  });

  test('non-existent proposalId returns 404 with a useful message', async () => {
    await seed();
    const r = await post({
      metricId: METRIC,
      targetDate: TARGET,
      proposalId: 'no-such-proposal',
      targetValue: 60,
      maxBudget: 5,
    });
    expect(r.status).toBe(404);
    expect(String(r.body.error)).toMatch(/no-such-proposal/);
    expect(String(r.body.error)).toMatch(/conditional/i);
  });

  test('non-string proposalId is rejected with 400', async () => {
    await seed();
    const r = await post({ metricId: METRIC, targetDate: TARGET, proposalId: 123, targetValue: 60, maxBudget: 5 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/proposalId/);
  });

  test('routing also works for directional mode (not just targetValue)', async () => {
    await seed();
    const r = await post({
      metricId: METRIC,
      targetDate: TARGET,
      proposalId: PROPOSAL_ID,
      direction: 'higher',
      amount: 5,
    });
    expect(r.status).toBe(201);
    expect(r.body.marketId).toBe(CONDITIONAL_MARKET);
  });

  test('targetValue mode self-limits to target — does not overshoot', async () => {
    await seed();
    // Target ~= 60 on a 0-100 range; with abundant maxBudget, consensus must land at 60.
    const r = await post({
      metricId: METRIC,
      targetDate: TARGET,
      proposalId: PROPOSAL_ID,
      targetValue: 60,
      maxBudget: 50,
    });
    expect(r.status).toBe(201);
    expect(r.body.consensus).toBeCloseTo(60, 4);
    // And cost must be strictly less than maxBudget — confirms self-limit, not budget-cap.
    expect(r.body.cost).toBeLessThan(50);
  });
});
