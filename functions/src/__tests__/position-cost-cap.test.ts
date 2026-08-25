/**
 * Per-participant buy-cost cap per market (workspaces.maxPositionCostPerMarket).
 *
 * The threat: signup grants free credits to every account, so in an Open
 * workspace one person with a few email addresses can deploy enough into a
 * single market to decide its outcome, making a public ship-what-the-market-
 * says commitment buyable. The cap bounds cumulative buy cost per participant
 * per market, both directions summed, and selling never refunds headroom, so
 * churning cannot stretch it.
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
import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-cap';
const TRADER = 'agent-capped';
const MARKET = 'market-cap-2028';

async function seed(cap: number) {
  await db.insert(agents).values([
    { id: 'agent-owner-cap', apiKeyHash: 'h-owner-cap', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-capped', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Cap Test',
    createdBy: 'agent-owner-cap',
    ownerAgentId: 'agent-owner-cap',
    visibility: 'public',
  });
  await db.update(workspaces).set({ maxPositionCostPerMarket: cap }).where(eq(workspaces.id, WS));
  await db.insert(metrics).values({
    id: 'metric-cap',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  // Deep book so cost tracks the requested amount closely.
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-cap',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 1000,
    pool: initialPool(1000),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

function trade(body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

describe('per-market buy-cost cap', () => {
  test('a buy that would cross the cap is rejected with cap arithmetic in the body', async () => {
    await seed(10);
    expect((await trade({ direction: 'higher', amount: 6 })).status).toBe(201);

    const res = await trade({ direction: 'higher', amount: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Position cap/);
    expect(res.body.cap).toBe(10);
    expect(res.body.spent).toBeCloseTo(6, 5);
  });

  test('the cap sums both directions, so hedged accumulation cannot dodge it', async () => {
    await seed(10);
    expect((await trade({ direction: 'higher', amount: 5 })).status).toBe(201);
    expect((await trade({ direction: 'lower', amount: 5 })).status).toBe(201);

    const res = await trade({ direction: 'higher', amount: 2 });
    expect(res.status).toBe(400);
    expect(res.body.spent).toBeCloseTo(10, 5);
  });

  test('selling does not refund cap headroom', async () => {
    await seed(10);
    const buy = await trade({ direction: 'higher', amount: 9 });
    expect(buy.status).toBe(201);
    const boughtShares = buy.body.shares as number;

    const sell = await trade({ sellShares: boughtShares, direction: 'higher' });
    expect(sell.status).toBe(201);

    // Position closed entirely, but cumulative buy cost stays at ~9 of 10.
    const res = await trade({ direction: 'higher', amount: 5 });
    expect(res.status).toBe(400);
    expect(res.body.spent).toBeCloseTo(9, 5);
  });

  test('filling exactly to the cap is allowed', async () => {
    await seed(10);
    expect((await trade({ direction: 'higher', amount: 4 })).status).toBe(201);
    expect((await trade({ direction: 'higher', amount: 6 })).status).toBe(201);
    expect((await trade({ direction: 'higher', amount: 0.5 })).status).toBe(400);
  });

  test('targetValue trades are capped through the same gate', async () => {
    await seed(10);
    const res = await trade({ targetValue: 90, maxBudget: 50 });
    // betTowardsValue spends up to maxBudget; the cap must stop it at 10.
    expect(res.status).toBe(400);
    expect(res.body.cap).toBe(10);
  });

  test('cap 0 means no cap', async () => {
    await seed(0);
    expect((await trade({ direction: 'higher', amount: 200 })).status).toBe(201);
  });
});
