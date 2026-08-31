/**
 * A BOOK THAT OPENS ON AN UNTRADED MARKET OPENS AT THE METRIC'S VALUE.
 *
 * Not "the daily spawn does". Every path that turns a baseline market from no
 * liquidity into a book, whichever endpoint supplied the credits. The owner
 * asked for the range-floor fix and then for the rest of it ("make sure the
 * bug isnt anywehre else etiher", 2026-08-31), and there were five paths, of
 * which one anchored:
 *
 *   1. the daily spawn                        (fixed, PR #73)
 *   2. the refresh funding an unfunded market (fixed, PR #73)
 *   3. POST /markets with auto-fund           (fixed, PR #73)
 *   4. POST /markets with an explicit liquidity amount
 *   5. POST /markets/liquidity/bulk, and POST /markets/:id/liquidity
 *
 * 4 and 5 are what this file pins. The rule they share is the name of the
 * file: which endpoint paid for the book cannot change the price it opens at.
 *
 * And its mirror, which matters just as much: a book that ALREADY has a price
 * is never re-anchored. A top-up is not a re-open, an already-anchored market
 * is not a blank one, and a conditional branch prices a different question
 * (the baseline adjusted for approval and the ask, services/proposals.ts), so
 * the metric's own value is the wrong number for it.
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
import { agents, markets, metrics, proposals, trades } from '../db/schema';
import { consensus } from '../lib/amm';
import { toAbsoluteDate } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-every-open';
const OWNER = 'owner-every-open';
const METRIC = 'm-revenue';
const NEAR = toAbsoluteDate('+2w');
const RANGE_MAX = 1000;
/** The metric reads $0 on a 0-1,000 range: the reported case. */
const VALUE = 0;
/** 2% of the range, the lowest a solvent LMSR book can be seeded at. */
const FLOOR_OPEN = 20;
const MIDPOINT = 500;

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
app.use('/api/predictions', predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-every', balance: toUnits(100_000) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Telarchy',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Telarchy revenue (USD)',
    value: VALUE,
    formula: '0',
    marketRangeMax: RANGE_MAX,
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
  opts: { targetDate?: string; proposalId?: string; shares?: [number, number]; liquidity?: number } = {},
) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Telarchy revenue (USD)',
    targetDate: opts.targetDate ?? NEAR,
    rangeMin: 0,
    rangeMax: RANGE_MAX,
    shares: opts.shares ?? ([0, 0] as [number, number]),
    liquidity: opts.liquidity ?? 0,
    pool: opts.liquidity ? opts.liquidity * Math.LN2 : 0,
    active: true,
    resolved: false,
    voided: false,
    proposalId: opts.proposalId ?? null,
    createdAt: new Date(),
  });
}

describe('a book opening on an untraded market opens at the metric value', () => {
  test('POST /markets with an explicit liquidity amount', async () => {
    const res = await request(app)
      .post('/api/predictions/markets')
      .send({ metricId: METRIC, targetDate: NEAR, liquidity: 250, skipAutoLiquidity: true });
    expect(res.status).toBe(201);
    const opened = await priceOf(res.body.id);
    expect(opened).toBeCloseTo(FLOOR_OPEN, 1);
    expect(opened).toBeLessThan(MIDPOINT / 2);
  });

  test('POST /markets/:id/liquidity, the first credits into an empty market', async () => {
    await seedBareMarket('mk-single');
    const res = await request(app).post('/api/predictions/markets/mk-single/liquidity').send({ amount: 250 });
    expect(res.status).toBe(200);
    expect(await priceOf('mk-single')).toBeCloseTo(FLOOR_OPEN, 1);
  });

  test('POST /markets/liquidity/bulk, the first credits into an empty market', async () => {
    await seedBareMarket('mk-bulk');
    const res = await request(app).post('/api/predictions/markets/liquidity/bulk').send({ amount: 250 });
    expect(res.status).toBe(200);
    expect(await priceOf('mk-bulk')).toBeCloseTo(FLOOR_OPEN, 1);
  });

  test('a far-horizon market anchors on every one of those paths too', async () => {
    // Owner rule 2026-08-31: the horizon stopped deciding where a book opens.
    await seedBareMarket('mk-far', { targetDate: '2099-12-31' });
    await request(app).post('/api/predictions/markets/mk-far/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-far')).toBeCloseTo(FLOOR_OPEN, 1);
    expect(await priceOf('mk-far')).not.toBeCloseTo(MIDPOINT, 0);
  });
});

describe('a book that already has a price is never re-anchored', () => {
  test('a top-up of a traded market does not move it', async () => {
    await seedBareMarket('mk-traded', { shares: [0, 120], liquidity: 300 });
    await db.insert(trades).values({
      id: 't-1',
      workspaceId: WS,
      marketId: 'mk-traded',
      agentId: OWNER,
      direction: 'higher',
      shares: 120,
      cost: 60,
      createdAt: new Date(),
    });
    const before = await priceOf('mk-traded');
    await request(app).post('/api/predictions/markets/mk-traded/liquidity').send({ amount: 250 });
    // Injecting scales b and the shares together, so the price is preserved
    // exactly; what must not happen is the anchor overwriting it.
    expect(await priceOf('mk-traded')).toBeCloseTo(before, 4);
    expect(before).toBeGreaterThan(MIDPOINT);
  });

  test('a top-up of an untraded but already ANCHORED market does not re-open it', async () => {
    // Shares outstanding with no trade behind them is exactly what an anchored
    // open looks like. It is a price, not a blank.
    await seedBareMarket('mk-anchored', { shares: [900, 0], liquidity: 300 });
    const before = await priceOf('mk-anchored');
    await request(app).post('/api/predictions/markets/mk-anchored/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-anchored')).toBeCloseTo(before, 4);
  });

  test('a conditional branch is never anchored to the metric value', async () => {
    // Its price is the baseline adjusted for the branch and the ask, which is
    // services/proposals.ts's question, not this one.
    await db.insert(proposals).values({
      id: 'prop-1',
      workspaceId: WS,
      title: 'A contract',
      description: 'x',
      status: 'pending',
      proposedBy: OWNER,
      createdAt: new Date(),
    });
    await seedBareMarket('mk-cond', { proposalId: 'prop-1' });
    await request(app).post('/api/predictions/markets/mk-cond/liquidity').send({ amount: 250 });
    expect(await priceOf('mk-cond')).toBeCloseTo(MIDPOINT, 0);
  });
});
