/**
 * NOTHING CAPS WHAT A PARTICIPANT MAY BUY IN ONE MARKET.
 *
 * The platform used to carry a per-participant, per-market buy-cost cap
 * (`workspaces.maxPositionCostPerMarket`, 5,000 on the live floors). It was
 * enforced server-side only, so the trading desk offered a trade the API then
 * refused, and a trader with conviction met a wall the screen never mentioned
 * (participant report 2026-08-31). The owner retired the feature outright:
 * no workspace has a cap, and no route may reintroduce one.
 *
 * These tests are the enforcement. Each of them asks for a cap the way an
 * operator would have, then buys straight through where the cap would have
 * been.
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
        capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

jest.mock('../middleware/roles', () => ({
  requireCapability: (cap: string) => (req: any, res: any, next: any) => {
    if (!req.auth?.capabilities?.has(cap)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { predictionsRouter } from '../routes/predictions';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/workspaces', authMiddleware, workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

const WS = 'ws-nocap';
const TRADER = 'agent-uncapped';
const MARKET = 'market-nocap-2028';
/** What the retired cap was set to on both live floors. */
const RETIRED_CAP = 5000;

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'agent-owner-nocap', apiKeyHash: 'h-owner-nocap', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-uncapped', balance: toUnits(50000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'No Cap',
    createdBy: 'agent-owner-nocap',
    ownerAgentId: 'agent-owner-nocap',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-nocap',
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
    metricId: 'metric-nocap',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 40000,
    pool: initialPool(40000),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
});

function trade(body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

/** What an operator would have done to cap this market's participants. */
function askForCap(credits: number) {
  return request(app)
    .put(`/api/workspaces/${WS}/settings`)
    .set('X-Test-Agent-Id', 'agent-owner-nocap')
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ maxPositionCostPerMarket: credits });
}

describe('no per-market buy cap exists', () => {
  test('a single buy past the retired 5,000 cap goes through', async () => {
    await askForCap(RETIRED_CAP);
    const res = await trade({ direction: 'higher', amount: RETIRED_CAP + 4000 });
    expect(res.status).toBe(201);
    expect(res.body.cost).toBeCloseTo(RETIRED_CAP + 4000, 3);
  });

  test('cumulative buys on one market are never refused', async () => {
    await askForCap(RETIRED_CAP);
    for (let i = 0; i < 12; i++) {
      const res = await trade({ direction: 'higher', amount: 1000 });
      expect(res.status).toBe(201);
    }
  });

  test('buying both directions past the old cap is allowed', async () => {
    await askForCap(RETIRED_CAP);
    expect((await trade({ direction: 'higher', amount: 4000 })).status).toBe(201);
    expect((await trade({ direction: 'lower', amount: 4000 })).status).toBe(201);
  });

  test('a targetValue trade spends its whole budget, cap or no cap', async () => {
    await askForCap(RETIRED_CAP);
    const res = await trade({ targetValue: 95, maxBudget: 20000 });
    expect(res.status).toBe(201);
    expect(res.body.cost).toBeGreaterThan(RETIRED_CAP);
  });

  test('a resting limit order reserves no headroom against later buys', async () => {
    await askForCap(RETIRED_CAP);
    const order = await request(app)
      .post('/api/predictions/limit-orders')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', limitValue: 30, budgetCredits: 4000 });
    expect(order.status).toBe(201);

    const res = await trade({ direction: 'higher', amount: 4000 });
    expect(res.status).toBe(201);
  });

  test('the settings route knows no cap field, and the public payload has none', async () => {
    // Not "accepted and ignored": the settings route recognises no field a cap
    // could arrive in, so a body carrying only that field updates nothing.
    const put = await askForCap(RETIRED_CAP);
    expect(put.status).toBe(400);
    expect(put.body.error).toMatch(/No fields to update/);

    const pub = await request(app).get(`/api/marketplace/${WS}`);
    expect(pub.status).toBe(200);
    expect(pub.body.maxPositionCostPerMarket).toBeUndefined();
    expect(pub.body.signupCredits).toBeDefined();
  });

  test('the database keeps no column a cap could live in', async () => {
    const res = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'workspaces'`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (Array.isArray(res) ? res : (res as any).rows) as { column_name: string }[];
    const names = rows.map(r => r.column_name);
    expect(names).not.toContain('max_position_cost_per_market');
  });
});
