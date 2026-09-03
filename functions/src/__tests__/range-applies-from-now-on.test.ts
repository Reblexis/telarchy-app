/**
 * The range applies from now on, never under anyone's money
 * (docs/market-integrity.md).
 *
 * Owner report 2026-09-03: "where do i modify metric raange exactly i dont
 * see tha tsetting anywhere". The control lived in the report dialog and
 * vanished once any book on the metric was traded; the edit itself was
 * refused with a 409 until every traded book settled. A traded book keeps the
 * range it opened with; everything else follows the new number.
 */

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { metricsRouter } from '../routes/metrics';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-range';
const OWNER = 'agent-range-owner';
const TRADER = 'agent-range-trader';
const METRIC = 'metric-range';
const TRADED = 'market-range-sep';
const UNTRADED = 'market-range-year';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: (req.headers['x-test-agent-id'] as string) ?? null,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-range-owner', balance: toUnits(5000) },
    { id: TRADER, apiKeyHash: 'h-range-trader', balance: toUnits(1000) },
  ]);
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Range',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Implied valuation (USD)',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
    timePreference: { enabled: false, halfLife: 1, customHorizons: ['2099-09', '2099'] },
  });
  for (const [id, targetDate] of [
    [TRADED, '2099-09'],
    [UNTRADED, '2099'],
  ] as const) {
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Implied valuation (USD)',
      targetDate,
      rangeMin: 0,
      rangeMax: 1000,
      shares: [0, 0] as [number, number],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
  }
});

const put = (body: Record<string, unknown>) =>
  request(app)
    .put(`/api/metrics/${METRIC}`)
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send(body);

const buy = (marketId: string, credits: number) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId, direction: 'higher', amount: credits });

async function openBooks() {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, METRIC), eq(markets.resolved, false)));
}

test('a range edit with a traded book is accepted, the traded book keeps its range, the untraded one re-opens at the new range', async () => {
  expect((await buy(TRADED, 40)).status).toBe(201);
  const [tradedBefore] = await db.select().from(markets).where(eq(markets.id, TRADED));

  const res = await put({ marketRangeMax: 20_000 });
  expect(res.status).toBe(200);
  expect(res.body.marketRangeMax).toBe(20_000);

  const [tradedAfter] = await db.select().from(markets).where(eq(markets.id, TRADED));
  expect(tradedAfter.resolved).toBe(false);
  expect(tradedAfter.voided).toBe(false);
  expect(tradedAfter.rangeMax).toBe(1000);
  expect(tradedAfter.shares).toEqual(tradedBefore.shares);

  const [oldYear] = await db.select().from(markets).where(eq(markets.id, UNTRADED));
  expect(oldYear.voided).toBe(true);

  const books = await openBooks();
  const year = books.find(m => m.targetDate === '2099');
  expect(year).toBeDefined();
  expect(year!.id).not.toBe(UNTRADED);
  expect(year!.rangeMax).toBe(20_000);
});

test('with no traded book every book re-opens at the new range', async () => {
  expect((await put({ marketRangeMax: 20_000 })).status).toBe(200);
  const books = await openBooks();
  expect(books).toHaveLength(2);
  for (const b of books) expect(b.rangeMax).toBe(20_000);
});

test('the formula is still refused while a book is traded', async () => {
  expect((await buy(TRADED, 40)).status).toBe(201);
  const res = await put({ formula: 'metric("x") * 2' });
  expect(res.status).toBe(409);
});

test('a range a traded book has outgrown can be widened for the books that follow', async () => {
  expect((await buy(TRADED, 40)).status).toBe(201);
  expect((await put({ value: 4200 })).status).toBe(200);
  expect((await put({ marketRangeMax: 10_000 })).status).toBe(200);
  const [m] = await db.select().from(metrics).where(eq(metrics.id, METRIC));
  expect(m.marketRangeMax).toBe(10_000);
});
