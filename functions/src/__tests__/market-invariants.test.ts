/**
 * Market invariants: the properties a trader implicitly trusts.
 *
 * Prompted by a real session (owner, 2026-08-10): "I bought then sold and
 * it went lower than it was originally." That episode was honest math (the
 * buy happened on a thin book, the operator re-anchored the price in
 * between, and the sell then pushed a fair book down), but the trust
 * question it raises deserves proofs, not reassurance. These tests pin the
 * AMM's ground rules end-to-end through the real trade route against a
 * real database:
 *
 *   1. A buy immediately unwound returns the price to where it started.
 *   2. The round trip never mints money: proceeds <= cost.
 *   3. Money is conserved: what traders lose, the pool gains, exactly.
 *   4. Order does not matter: interleaved unwinds land on the same price.
 *   5. Selling in pieces equals selling at once.
 *   6. Deepening the book preserves the price and dampens moves.
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
import { agents, markets, metrics } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
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

const WS = 'ws-invariant';
const A = 'agent-inv-a';
const B_TRADER = 'agent-inv-b';
const MARKET = 'market-inv-2028';

async function seed(liquidity = 200) {
  await db.insert(agents).values([
    { id: 'agent-owner-inv', apiKeyHash: 'h-owner-inv', balance: 0 },
    { id: A, apiKeyHash: 'h-inv-a', balance: toUnits(1000) },
    { id: B_TRADER, apiKeyHash: 'h-inv-b', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Invariant Test',
    createdBy: 'agent-owner-inv',
    ownerAgentId: 'agent-owner-inv',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-inv',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-inv',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity,
    pool: initialPool(liquidity),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

function trade(agentId: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

async function marketState() {
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return {
    consensus: consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax)!,
    pool: m.pool ?? 0,
    shares: m.shares as [number, number],
    liquidity: m.liquidity,
  };
}

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

describe('a buy immediately unwound', () => {
  for (const direction of ['higher', 'lower'] as const) {
    test(`${direction}: the price returns exactly to where it started`, async () => {
      await seed();
      const before = await marketState();

      const buy = await trade(A, { direction, amount: 50 });
      expect(buy.status).toBe(201);
      const moved = await marketState();
      expect(moved.consensus).not.toBeCloseTo(before.consensus, 2);

      const sell = await trade(A, { direction, sellShares: buy.body.shares });
      expect(sell.status).toBe(201);

      const after = await marketState();
      expect(after.consensus).toBeCloseTo(before.consensus, 2);
      expect(after.shares[0]).toBeCloseTo(before.shares[0], 6);
      expect(after.shares[1]).toBeCloseTo(before.shares[1], 6);
    });

    test(`${direction}: the round trip never mints money`, async () => {
      await seed();
      const buy = await trade(A, { direction, amount: 50 });
      const sell = await trade(A, { direction, sellShares: buy.body.shares });

      const cost = buy.body.cost as number;
      const proceeds = sell.body.proceeds as number;
      expect(proceeds).toBeLessThanOrEqual(cost + 1e-6);
      // And the friction is rounding-sized, not a hidden fee.
      expect(cost - proceeds).toBeLessThan(0.05);
    });
  }
});

describe('conservation', () => {
  test('what traders lose, the pool gains, exactly', async () => {
    await seed();
    const before = await marketState();
    const balA0 = await balanceOf(A);
    const balB0 = await balanceOf(B_TRADER);

    // An arbitrary tangle of trades, partial unwinds included.
    const buyA = await trade(A, { direction: 'higher', amount: 80 });
    const buyB = await trade(B_TRADER, { direction: 'lower', amount: 40 });
    await trade(A, { direction: 'higher', sellShares: (buyA.body.shares as number) / 2 });
    await trade(B_TRADER, { targetValue: 70, maxBudget: 30 });
    await trade(B_TRADER, { direction: 'lower', sellShares: (buyB.body.shares as number) / 3 });

    const after = await marketState();
    const traderDelta = (await balanceOf(A)) - balA0 + (await balanceOf(B_TRADER)) - balB0;
    const poolDelta = after.pool - before.pool;
    // Credits neither appear nor vanish: balances down = pool up.
    expect(traderDelta + poolDelta).toBeCloseTo(0, 6);
  });

  test('interleaved unwinds land on the starting price no matter the order', async () => {
    await seed();
    const before = await marketState();

    const buyA = await trade(A, { direction: 'higher', amount: 60 });
    const buyB = await trade(B_TRADER, { direction: 'higher', amount: 35 });
    // A bought first but exits last; LMSR is a function of net state, so
    // the exit order cannot matter.
    await trade(B_TRADER, { direction: 'higher', sellShares: buyB.body.shares });
    await trade(A, { direction: 'higher', sellShares: buyA.body.shares });

    const after = await marketState();
    expect(after.consensus).toBeCloseTo(before.consensus, 2);
  });

  test('selling in pieces equals selling at once', async () => {
    await seed();
    const buy = await trade(A, { direction: 'higher', amount: 50 });
    const shares = buy.body.shares as number;

    const s1 = await trade(A, { direction: 'higher', sellShares: shares / 4 });
    expect(s1.status).toBe(201);
    const s2 = await trade(A, { direction: 'higher', sellShares: shares / 4 });
    expect(s2.status).toBe(201);
    // The last piece is whatever the position actually still holds (the
    // stored row rounds, so "shares / 2" can overshoot by a hair and be
    // refused as overselling, which is itself correct behaviour).
    const posRes = await request(app)
      .get('/api/predictions/positions')
      .set('X-Test-Agent-Id', A)
      .set('X-Workspace-Id', WS);
    const remaining = (posRes.body as Array<{ direction: string; shares: number }>).find(
      r => r.direction === 'higher',
    )!.shares;
    const s3 = await trade(A, { direction: 'higher', sellShares: remaining });
    expect(s3.status).toBe(201);
    const piecewise = (s1.body.proceeds as number) + (s2.body.proceeds as number) + (s3.body.proceeds as number);

    // Same shares on a fresh identical market, sold in one order.
    await truncateAll();
    await seed();
    const buy2 = await trade(A, { direction: 'higher', amount: 50 });
    const sAll = await trade(A, { direction: 'higher', sellShares: buy2.body.shares });

    expect(piecewise).toBeCloseTo(sAll.body.proceeds as number, 1);
    expect((await marketState()).consensus).toBeCloseTo(50, 2);
  });
});

describe('depth', () => {
  test('a deeper book moves less for the same money', async () => {
    await seed(50);
    const thin = await trade(A, { direction: 'higher', amount: 25 });
    const thinMove = Math.abs((thin.body.consensus as number) - 50);

    await truncateAll();
    await seed(500);
    const deep = await trade(A, { direction: 'higher', amount: 25 });
    const deepMove = Math.abs((deep.body.consensus as number) - 50);

    expect(thinMove).toBeGreaterThan(deepMove * 5);
  });

  test('what the owner saw: buy thin, someone re-anchors, sell fair, and the trip loses money honestly', async () => {
    // Not a defect test: a record of the 2026-08-10 session, so the shape
    // of that loss is pinned as understood-and-expected, with the price
    // ending below its start because the final sell pushes a fair book.
    await seed(30);
    const buy = await trade(A, { direction: 'higher', amount: 25 });
    expect(buy.body.consensus as number).toBeGreaterThan(75); // thin book flung

    // The operator re-anchors to the start.
    await trade(B_TRADER, { targetValue: 50, maxBudget: 500 });
    const anchored = await marketState();
    expect(anchored.consensus).toBeCloseTo(50, 1);

    const sell = await trade(A, { direction: 'higher', sellShares: buy.body.shares });
    expect(sell.status).toBe(201);
    // The trip loses real money, and the market ends below its start.
    expect(sell.body.proceeds as number).toBeLessThan(buy.body.cost as number);
    expect((await marketState()).consensus).toBeLessThan(50);
  });
});
