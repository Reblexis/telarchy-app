/**
 * A voided market does not occupy its (metric, targetDate) slot.
 *
 * Cancelling an untraded market and opening a fresh one in its place is the
 * documented way to change a book nobody has money in: it is what resizing
 * liquidity requires, and what the refresh cron does for the horizons it
 * maintains. POST /api/predictions/markets counted the dead row, so the
 * second create 409'd and the floor was left with no market at all
 * (2026-08-19, resizing the hero market's liquidity two days before Season 0
 * started). This test fails against that check.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => require('crypto').createHash('sha256').update(raw).digest('hex'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-owner',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics } from '../db/schema';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-void-slot';
const OWNER = 'agent-owner';
const METRIC = 'metric-void-slot';
const TARGET = '2028';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(10_000) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Void Slot',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
});

/** `liquidity` in the request body is POOL CREDITS, not b: the market opens
 *  with b = pool / ln 2. Easy to get backwards, so the assertions below spell
 *  the conversion out. */
const create = (liquidity: number) =>
  request(app)
    .post('/api/predictions/markets')
    .set('X-Workspace-Id', WS)
    .send({ metricId: METRIC, targetDate: TARGET, rangeMin: 0, rangeMax: 100, liquidity, skipAutoLiquidity: true });

const live = () =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.voided, false)));

describe('recreating a market whose slot was voided', () => {
  test('a fresh market can open where a cancelled one stood, at a new size', async () => {
    const first = await create(500);
    expect(first.status).toBe(201);
    const firstId = first.body.id ?? first.body.marketId;

    await request(app).post(`/api/predictions/markets/${firstId}/void`).set('X-Workspace-Id', WS).send({});

    const second = await create(2000);
    expect(second.status).toBe(201);

    const open = await live();
    expect(open).toHaveLength(1);
    expect(open[0].liquidity).toBeCloseTo(2000 / Math.LN2, 5);
    expect(open[0].pool).toBeCloseTo(2000, 5);
    expect(open[0].id).not.toBe(firstId);
  });

  test('a live market still blocks a duplicate', async () => {
    expect((await create(500)).status).toBe(201);
    const duplicate = await create(500);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already exists/i);
    expect(await live()).toHaveLength(1);
  });
});
