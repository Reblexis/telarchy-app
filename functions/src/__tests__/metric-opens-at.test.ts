/**
 * AN OWNER MAY NAME WHERE A METRIC'S BOOKS OPEN, AND IT REPLACES THE READING,
 * NOTHING ELSE (docs/ui-conventions.md, "Where markets open").
 *
 * Owner report 2026-09-17, the chess floor: "why does the market call say 0.1
 * yet when i look at activity i dont see any trade". A game's score exists
 * only once the game has finished, so between games the metric's value is the
 * LAST game's result, and the next game's book opened there: 0 after a loss,
 * clamped to 0.1, a call nobody had made.
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
  requireSelfOrAdmin: () => (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals } from '../db/schema';
import { consensus } from '../lib/amm';
import { toAbsoluteDate } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { metricsRouter } from '../routes/metrics';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-opens-at';
const OWNER = 'owner-opens-at';
const METRIC = 'm-score';
const NEAR = toAbsoluteDate('+2w');
const FAR = toAbsoluteDate('+8w');
/** A game score: 0 a loss, 50 a draw, 100 a win. */
const RANGE_MAX = 100;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    workspaceId: WS,
    agentId: OWNER,
    capabilities: new Set(['manage', 'read', 'trade']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/predictions', predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});

/** The last game was lost: the reading is 0. */
async function seedMetric(opensAt: number | null) {
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Game score',
    value: 0,
    formula: '0',
    marketRangeMax: RANGE_MAX,
    timePreference: { enabled: false },
    opensAt,
  });
}

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-opens-at', balance: toUnits(100_000) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Chess',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
});

async function priceOf(marketId: string): Promise<number> {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, WS)));
  return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) as number;
}

async function seedBareMarket(
  id: string,
  opts: {
    targetDate?: string;
    proposalId?: string;
    shares?: [number, number];
    liquidity?: number;
    traded?: number;
  } = {},
) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Game score',
    targetDate: opts.targetDate ?? NEAR,
    rangeMin: 0,
    rangeMax: RANGE_MAX,
    shares: opts.shares ?? ([0, 0] as [number, number]),
    liquidity: opts.liquidity ?? 0,
    pool: opts.liquidity ? opts.liquidity * Math.LN2 : 0,
    tradedVolume: opts.traded ?? 0,
    active: true,
    resolved: false,
    voided: false,
    proposalId: opts.proposalId ?? null,
    createdAt: new Date(),
  });
}

const fund = (id: string) => request(app).post(`/api/predictions/markets/${id}/liquidity`).send({ amount: 250 });

describe('where a book opens when the owner has named the opening value', () => {
  test('the market call without a trade: a lost game no longer opens the next book at 0.1', async () => {
    await seedMetric(35);
    await seedBareMarket('mk');
    expect((await fund('mk')).status).toBe(200);
    expect(await priceOf('mk')).toBeCloseTo(35, 1);
  });

  test('with no opening value named, the book still opens at the reading', async () => {
    await seedMetric(null);
    await seedBareMarket('mk');
    await fund('mk');
    // One part in a thousand of a 0-100 range (ANCHOR_P_FLOOR).
    expect(await priceOf('mk')).toBeCloseTo(0.1, 2);
  });

  test('a book made by POST /markets opens there too', async () => {
    await seedMetric(35);
    const res = await request(app)
      .post('/api/predictions/markets')
      .send({ metricId: METRIC, targetDate: NEAR, liquidity: 250, skipAutoLiquidity: true });
    expect(res.status).toBe(201);
    expect(await priceOf(res.body.id)).toBeCloseTo(35, 1);
  });

  test('an opening value at the edge of the range opens at the clamp, like a reading there', async () => {
    await seedMetric(0);
    await seedBareMarket('mk-lo');
    await fund('mk-lo');
    expect(await priceOf('mk-lo')).toBeCloseTo(0.1, 2);
    await db.update(metrics).set({ opensAt: 100 }).where(eq(metrics.id, METRIC));
    await seedBareMarket('mk-hi', { targetDate: FAR });
    await fund('mk-hi');
    expect(await priceOf('mk-hi')).toBeCloseTo(99.9, 2);
  });

  test("A PRICE SOMEBODY PAID BEATS THE OWNER'S STATEMENT: a traded open book of the same metric wins", async () => {
    await seedMetric(35);
    await seedBareMarket('mk-traded', { targetDate: FAR, shares: [0, 120], liquidity: 300, traded: 60 });
    const sibling = await priceOf('mk-traded');
    await seedBareMarket('mk');
    await fund('mk');
    expect(await priceOf('mk')).toBeCloseTo(sibling, 1);
    expect(Math.abs(sibling - 35)).toBeGreaterThan(5);
  });

  test('a book already anchored is not moved when the opening value changes', async () => {
    await seedMetric(35);
    await seedBareMarket('mk');
    await fund('mk');
    const res = await request(app).put(`/api/metrics/${METRIC}`).send({ opensAt: 80 });
    expect(res.status).toBe(200);
    await fund('mk');
    expect(await priceOf('mk')).toBeCloseTo(35, 1);
  });

  test('a conditional branch follows its baseline, never the opening value', async () => {
    await seedMetric(35);
    await seedBareMarket('mk-base', { shares: [0, 120], liquidity: 300, traded: 60 });
    const base = await priceOf('mk-base');
    await db.insert(proposals).values({
      id: 'p-1',
      workspaceId: WS,
      title: 'e4',
      description: '',
      status: 'pending',
      proposedBy: OWNER,
      createdAt: new Date(),
    } as never);
    await seedBareMarket('mk-branch', { proposalId: 'p-1' });
    await db.update(markets).set({ branch: 'approved' }).where(eq(markets.id, 'mk-branch'));
    await fund('mk-branch');
    expect(await priceOf('mk-branch')).toBeCloseTo(base, 1);
  });
});

describe('naming the opening value', () => {
  test('POST /api/metrics stores it and returns it', async () => {
    const res = await request(app)
      .post('/api/metrics')
      .send({ name: 'Game score', marketRangeMax: 100, opensAt: 40, timePreference: null });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(metrics).where(eq(metrics.id, res.body.id));
    expect(row.opensAt).toBe(40);
    const list = await request(app).get('/api/metrics');
    expect(list.body.find((m: { id: string }) => m.id === res.body.id).opensAt).toBe(40);
  });

  test('it is null unless named', async () => {
    const res = await request(app).post('/api/metrics').send({ name: 'Plain', timePreference: null });
    const [row] = await db.select().from(metrics).where(eq(metrics.id, res.body.id));
    expect(row.opensAt).toBeNull();
  });

  test('PUT sets it, changes it, and null clears it', async () => {
    await seedMetric(null);
    expect((await request(app).put(`/api/metrics/${METRIC}`).send({ opensAt: 12.5 })).status).toBe(200);
    expect((await db.select().from(metrics).where(eq(metrics.id, METRIC)))[0].opensAt).toBe(12.5);
    expect((await request(app).put(`/api/metrics/${METRIC}`).send({ opensAt: null })).status).toBe(200);
    expect((await db.select().from(metrics).where(eq(metrics.id, METRIC)))[0].opensAt).toBeNull();
  });

  test('a PUT that does not name it leaves it alone', async () => {
    await seedMetric(35);
    await request(app).put(`/api/metrics/${METRIC}`).send({ description: 'the score of the game' });
    expect((await db.select().from(metrics).where(eq(metrics.id, METRIC)))[0].opensAt).toBe(35);
  });

  test('setting it never voids or moves an open traded market', async () => {
    await seedMetric(null);
    await seedBareMarket('mk-traded', { shares: [0, 120], liquidity: 300, traded: 60 });
    const before = await priceOf('mk-traded');
    expect((await request(app).put(`/api/metrics/${METRIC}`).send({ opensAt: 35 })).status).toBe(200);
    const [m] = await db.select().from(markets).where(eq(markets.id, 'mk-traded'));
    expect(m.voided).toBe(false);
    expect(await priceOf('mk-traded')).toBeCloseTo(before, 6);
  });

  test.each([
    ['a string', '35'],
    ['a negative number', -1],
    ['a number above the range', 100.5],
    ['an array', [35]],
    ['a boolean', true],
  ])('%s is refused with 400', async (_label, bad) => {
    await seedMetric(10);
    const res = await request(app).put(`/api/metrics/${METRIC}`).send({ opensAt: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opensAt/);
    expect((await db.select().from(metrics).where(eq(metrics.id, METRIC)))[0].opensAt).toBe(10);
  });

  test('on create it is checked against the range sent with it', async () => {
    const res = await request(app)
      .post('/api/metrics')
      .send({ name: 'Game score', marketRangeMax: 100, opensAt: 500, timePreference: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opensAt/);
  });

  test('a computed metric cannot carry it: its books are not opened on a statement', async () => {
    const res = await request(app)
      .post('/api/metrics')
      .send({ name: 'Sum', formula: 'a + b', opensAt: 5, timePreference: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opensAt/);
  });

  test('narrowing the range below it is refused until it is changed', async () => {
    await seedMetric(80);
    const res = await request(app).put(`/api/metrics/${METRIC}`).send({ marketRangeMax: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opensAt/);
    const ok = await request(app).put(`/api/metrics/${METRIC}`).send({ marketRangeMax: 50, opensAt: 25 });
    expect(ok.status).toBe(200);
  });
});
