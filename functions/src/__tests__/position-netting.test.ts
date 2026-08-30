/**
 * A trader holds ONE net side, by REDEMPTION (owner ask 2026-08-30, after
 * Manifold; docs/ui-conventions.md). Buying the side opposite a held
 * position buys against the LIVE book and then cashes every matched
 * higher+lower pair at the 1 credit it is certainly worth. Nobody ends up
 * holding both sides, and unlike the liquidation this replaced (2026-08-11
 * to 2026-08-30), a small contrarian bet no longer dumps the whole
 * position at a spread nobody asked to pay.
 *
 * These pin the invariant, the price neutrality, and the money, through
 * the real trade route against a real database.
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

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, creditLedger, markets, metrics, positions } from '../db/schema';
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
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-net';
const TRADER = 'agent-net';
const MARKET = 'market-net';

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-owner-net', apiKeyHash: 'h-owner-net', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-net', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Netting Test',
    createdBy: 'agent-owner-net',
    ownerAgentId: 'agent-owner-net',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-net',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-net',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 500,
    pool: initialPool(500),
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

async function pos(dir: 'higher' | 'lower'): Promise<number> {
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, `${TRADER}_${MARKET}_${dir}`), eq(positions.workspaceId, WS)));
  return row?.shares ?? 0;
}
async function balance(): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, TRADER));
  return fromUnits(row.balance as number);
}

describe('a buy on the opposite side redeems matched pairs', () => {
  test('betting less than you hold shrinks the position and opens nothing', async () => {
    await seed();
    expect((await trade({ direction: 'higher', amount: 100 })).status).toBe(201);
    const before = await pos('higher');
    expect(before).toBeGreaterThan(0);

    // 50 credits of lower buys fewer shares than the 100 credits of higher
    // already held, so every bought share pairs off against the position.
    const res = await trade({ direction: 'lower', amount: 50 });
    expect(res.status).toBe(201);
    const after = await pos('higher');
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    // Never both sides: the lower shares were cashed as they were bought.
    expect(await pos('lower')).toBeLessThan(1e-6);
    expect(res.body.redeemed).toBeCloseTo(before - after, 6);
  });

  test('betting more than you hold flips the side', async () => {
    await seed();
    await trade({ direction: 'lower', amount: 40 });
    const held = await pos('lower');
    const res = await trade({ direction: 'higher', amount: 300 });
    expect(res.status).toBe(201);
    // The whole lower position paired off; what is left is higher.
    expect(await pos('lower')).toBeLessThan(1e-6);
    expect(await pos('higher')).toBeGreaterThan(0);
    expect(res.body.redeemed).toBeCloseTo(held, 6);
  });

  test('redemption pays exactly 1 credit a pair, and the pool pays it', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const afterFirst = await balance();
    expect(afterFirst).toBeCloseTo(900, 1);
    const [before] = await db.select().from(markets).where(eq(markets.id, MARKET));

    const res = await trade({ direction: 'lower', amount: 50 });
    const redeemed = res.body.redeemed as number;
    expect(redeemed).toBeGreaterThan(0);

    // Spent 50 on the bet, got 1 credit per pair back.
    expect(await balance()).toBeCloseTo(900 - 50 + redeemed, 6);

    // The pool paid it, and shed the same liability: both share counts fall
    // by the pairs redeemed, which is why the price does not move.
    const [after] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const bShares = before.shares as [number, number];
    const aShares = after.shares as [number, number];
    expect(aShares[0] - (bShares[0] + res.body.shares)).toBeCloseTo(-redeemed, 6);
    expect(aShares[1] - bShares[1]).toBeCloseTo(-redeemed, 6);
    expect((after.pool as number) - (before.pool as number)).toBeCloseTo(res.body.cost - redeemed, 6);
  });

  test('the held position does not move where the bet lands', async () => {
    // The heart of it (owner report 2026-08-30: 25 credits moved a market
    // from $7,146 to $10,706, almost all of it a forced close). Redemption
    // takes the same amount off both sides, so an LMSR price, which reads
    // q1 - q0, cannot notice it.
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const holding = await trade({ direction: 'lower', amount: 50 });
    expect(holding.status).toBe(201);

    // The same book, the same bet, from a trader holding nothing.
    await truncateAll();
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    await db.delete(positions).where(and(eq(positions.marketId, MARKET), eq(positions.workspaceId, WS)));
    const flat = await trade({ direction: 'lower', amount: 50 });
    expect(flat.status).toBe(201);

    expect(holding.body.consensus).toBeCloseTo(flat.body.consensus, 6);
  });
});

describe('a buy on the SAME side accumulates, no netting', () => {
  test('hold higher, buy more higher: one growing higher position, no lower', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 60 });
    const first = await pos('higher');
    await trade({ direction: 'higher', amount: 60 });
    expect(await pos('higher')).toBeGreaterThan(first);
    expect(await pos('lower')).toBe(0);
  });
});

describe('betting toward a value redeems against the opposite too', () => {
  test('hold lower, bet toward a value above the price: the lower side pairs off', async () => {
    await seed();
    await trade({ direction: 'lower', amount: 100 }); // price now below 50
    // Target a value above the current price -> a higher move -> nets the lower.
    const res = await trade({ targetValue: 80, maxBudget: 200 });
    expect(res.status).toBe(201);
    expect(await pos('lower')).toBeLessThan(1e-6);
    expect(await pos('higher')).toBeGreaterThan(0);
  });
});

describe('the single-sided invariant holds across a churn sequence', () => {
  test('alternating buys never leave both sides held', async () => {
    await seed();
    for (const dir of ['higher', 'lower', 'higher', 'lower', 'higher'] as const) {
      const res = await trade({ direction: dir, amount: 40 });
      expect(res.status).toBe(201);
      const h = await pos('higher');
      const l = await pos('lower');
      // At most one side is non-zero after every trade.
      expect(Math.min(h, l)).toBeLessThan(1e-6);
    }
  });
});

describe('a redemption is on the record, and the replay can see it', () => {
  test('the price replay ends where the book stands', async () => {
    // The lesson of 2026-08-29 (docs/market-integrity.md I4): the chart
    // REPLAYS the ledgers, so a change to markets.shares that leaves no
    // row makes the chart quote prices the book never printed. Redemption
    // moves both share counts, so it writes a row per side.
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const res = await trade({ direction: 'lower', amount: 50 });
    expect(res.body.redeemed).toBeGreaterThan(0);

    const { marketPriceSeries } = await import('../services/predictions');
    const series = await marketPriceSeries(MARKET, WS);
    const [row] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const live = consensus(row.shares as [number, number], row.liquidity, row.rangeMin, row.rangeMax)!;
    expect(series[series.length - 1].consensus).toBeCloseTo(live, 2);
    // And the redemption itself printed no new price: the point it added
    // sits at the same value as the buy that preceded it.
    expect(series[series.length - 1].consensus).toBeCloseTo(res.body.consensus, 2);
  });

  test('the credits redeemed leave a ledger row that says why', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const res = await trade({ direction: 'lower', amount: 50 });

    const rows = await db
      .select()
      .from(creditLedger)
      .where(
        and(eq(creditLedger.workspaceId, WS), eq(creditLedger.agentId, TRADER), eq(creditLedger.reason, 'redeem')),
      );
    expect(rows).toHaveLength(1);
    expect(fromUnits(rows[0].deltaUnits as number)).toBeCloseTo(res.body.redeemed, 6);
    expect(rows[0].refId).toBe(MARKET);
  });
});
