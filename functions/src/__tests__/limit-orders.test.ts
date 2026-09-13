/**
 * Resting limit orders.
 *
 * The two properties worth defending in tests: money is reserved at placement
 * (a resting order is credits set aside, not an intention that might bounce
 * later), and a fill never pushes the price past its own limit (otherwise it
 * is a delayed market order wearing a limit order's name). The third is that
 * someone else's resting order can never make your trade fail.
 *
 * Design: docs/limit-orders.md.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      const caps = req.headers['x-test-caps']
        ? String(req.headers['x-test-caps']).split(',')
        : ['read', 'trade', 'manage'];
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(caps),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, limitOrders, markets, metrics, positions } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { voidMarket } from '../services/markets';
import { releaseLimitOrdersForMarket, sweepLimitOrders } from '../services/trading';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  const code = err instanceof AppError && err.code ? { code: err.code } : {};
  res.status(status).json({ error: err.message, ...extra, ...code });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-limit';
const RESTER = 'agent-rester';
const MOVER = 'agent-mover';
const MARKET = 'market-limit-2028';

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-owner-limit', apiKeyHash: 'h-owner-limit', balance: 0 },
    { id: RESTER, apiKeyHash: 'h-rester', balance: toUnits(1000) },
    { id: MOVER, apiKeyHash: 'h-mover', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Limit Test',
    createdBy: 'agent-owner-limit',
    ownerAgentId: 'agent-owner-limit',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-limit',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-limit',
    metricName: 'Throughput',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

function as(agentId: string) {
  return {
    place: (body: Record<string, unknown>) =>
      request(app)
        .post('/api/predictions/limit-orders')
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS)
        .set('Content-Type', 'application/json')
        .send({ marketId: MARKET, ...body }),
    list: (query = '') =>
      request(app)
        .get(`/api/predictions/limit-orders${query}`)
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS),
    cancel: (id: string) =>
      request(app)
        .delete(`/api/predictions/limit-orders/${id}`)
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS),
    trade: (body: Record<string, unknown>) =>
      request(app)
        .post('/api/predictions/trade')
        .set('X-Test-Agent-Id', agentId)
        .set('X-Workspace-Id', WS)
        .set('Content-Type', 'application/json')
        .send({ marketId: MARKET, ...body }),
  };
}

async function balanceOf(agentId: string): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return fromUnits(row.balance as number);
}

async function priceOf(): Promise<number> {
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax)!;
}

describe('placing an order', () => {
  test('reserves the budget by debiting it at placement', async () => {
    await seed();
    const before = await balanceOf(RESTER);

    const res = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    expect(res.status).toBe(201);
    expect(res.body.remainingCredits).toBe(100);
    expect(await balanceOf(RESTER)).toBeCloseTo(before - 100, 5);
  });

  test('a buy limit the market already passed fills now up to its limit, and the rest rests', async () => {
    await seed();
    // Market sits at 50. "Buy higher while at or below 60" is true right now.
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 100 });
    expect(res.status).toBe(201);
    expect(res.body.filledNow.cost).toBeGreaterThan(0);
    expect(res.body.filledNow.cost).toBeLessThan(100);
    expect(res.body.filledNow.consensus).toBeCloseTo(60, 1);
    expect(await priceOf()).toBeCloseTo(60, 1);
    expect(res.body.status).toBe('open');
    expect(res.body.filledCredits).toBeCloseTo(res.body.filledNow.cost, 6);
    expect(res.body.remainingCredits).toBeCloseTo(100 - res.body.filledNow.cost, 6);
    // What filled and what rests are exactly the budget, and nothing more.
    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);
    const [pos] = await db
      .select()
      .from(positions)
      .where(and(eq(positions.agentId, RESTER), eq(positions.direction, 'higher')));
    expect(pos.shares).toBeCloseTo(res.body.filledNow.shares, 6);
  });

  test('a crossed buy whose budget cannot reach its limit spends it all now and closes filled', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 90, budgetCredits: 5 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('filled');
    expect(res.body.filledNow.cost).toBeCloseTo(5, 4);
    expect(res.body.remainingCredits).toBeCloseTo(0, 4);
    expect(await priceOf()).toBeLessThan(90);
    expect(await balanceOf(RESTER)).toBeCloseTo(995, 4);
    expect((await as(RESTER).list()).body).toHaveLength(0);
  });

  test('a crossed buy never moves the price past its own limit', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'lower', limitValue: 40, budgetCredits: 900 });
    expect(res.status).toBe(201);
    expect(await priceOf()).toBeCloseTo(40, 1);
    expect(await priceOf()).toBeGreaterThanOrEqual(40 - 0.01);
  });

  test('a crossed buy fills the resting orders its own move crosses', async () => {
    await seed();
    const resting = await as(MOVER).place({ direction: 'lower', limitValue: 55, budgetCredits: 50 });
    expect(resting.status).toBe(201);
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 100 });
    expect(res.status).toBe(201);
    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, resting.body.id));
    expect(order.filledCredits).toBeGreaterThan(0);
  });

  test('a buy limit exactly at the market fills nothing and rests', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 50, budgetCredits: 100 });
    expect(res.status).toBe(201);
    expect(res.body.filledNow).toBeNull();
    expect(res.body.status).toBe('open');
    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);
    expect(await priceOf()).toBeCloseTo(50, 5);
  });

  test('a crossed buy the balance cannot cover trades nothing', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 2000 });
    expect(res.status).toBe(400);
    expect(await priceOf()).toBeCloseTo(50, 5);
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });

  test('a limit outside the market range is refused', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 120, budgetCredits: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/strictly between/);
  });

  test('a reservation is money out of the balance, and nothing else', async () => {
    // The only ceiling on a position is the balance (no per-market cap
    // exists), so a resting order limits later trading by exactly what it
    // reserves: not a credit more, and not a credit less.
    await seed();
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 900 })).status).toBe(201);

    const tooBig = await as(RESTER).trade({ direction: 'higher', amount: 200 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toMatch(/Insufficient balance/);
    expect(tooBig.body.balance).toBeCloseTo(100, 5);

    const fits = await as(RESTER).trade({ direction: 'higher', amount: 100 });
    expect(fits.status).toBe(201);
  });
});

describe('filling', () => {
  test('a trade that crosses the limit fills the order, and the fill stops at the limit', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 500 });
    expect(placed.status).toBe(201);

    // Push the price well below 40. The resting order should buy back up to
    // 40 and stop there, not to wherever its budget could reach.
    const res = await as(MOVER).trade({ targetValue: 20, maxBudget: 500 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills).toHaveLength(1);
    expect(res.body.limitFills[0].direction).toBe('higher');
    expect(res.body.limitFills[0].limitValue).toBe(40);

    expect(await priceOf()).toBeCloseTo(40, 1);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.filledCredits).toBeGreaterThan(0);
    expect(order.filledCredits).toBeLessThan(order.budgetCredits);
    // Partly filled and still resting at the same limit.
    expect(order.status).toBe('open');
  });

  test('the fill spends reserved credits, not fresh balance', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 500 });
    const afterPlacement = await balanceOf(RESTER);

    await as(MOVER).trade({ targetValue: 20, maxBudget: 500 });

    // The fill moves money from the reservation into a position, so the
    // spendable balance is untouched by someone else's trade.
    expect(await balanceOf(RESTER)).toBeCloseTo(afterPlacement, 5);
  });

  test('a budget too small to reach the limit is spent entirely and the order closes', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 5 });

    const res = await as(MOVER).trade({ targetValue: 20, maxBudget: 500 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills).toHaveLength(1);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.status).toBe('filled');
    expect(order.filledCredits).toBeCloseTo(5, 1);
    // Price moved back up a little, but nowhere near the limit.
    expect(await priceOf()).toBeLessThan(40);
  });

  test('a lower order fills when the price rises through its limit', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'lower', limitValue: 70, budgetCredits: 500 });
    expect(placed.status).toBe(201);

    const res = await as(MOVER).trade({ targetValue: 90, maxBudget: 500 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills[0].direction).toBe('lower');
    expect(await priceOf()).toBeCloseTo(70, 1);
  });

  test('an untouched limit is left alone', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 20, budgetCredits: 500 });

    const res = await as(MOVER).trade({ targetValue: 40, maxBudget: 500 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills).toBeUndefined();

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.filledCredits).toBe(0);
    expect(order.status).toBe('open');
  });

  test('an order that cannot fill does not fail the trade that crossed it', async () => {
    // Any fill can throw; what matters is where the failure stops. The
    // rester's balance is forced below what the released reservation covers,
    // so the fill's own buy is refused inside its savepoint. The order is
    // left resting; the stranger's trade must still stand.
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 500 });
    await db
      .update(agents)
      .set({ balance: toUnits(-495) })
      .where(eq(agents.id, RESTER));

    const res = await as(MOVER).trade({ targetValue: 20, maxBudget: 250 });
    expect(res.status).toBe(201);
    expect(await priceOf()).toBeLessThan(40);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.status).toBe('open');
    expect(order.filledCredits).toBe(0);
  });

  test('an expired order is swept instead of filled, and refunded', async () => {
    await seed();
    const placed = await as(RESTER).place({
      direction: 'higher',
      limitValue: 40,
      budgetCredits: 100,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(placed.status).toBe(201);
    await db
      .update(limitOrders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(limitOrders.id, placed.body.id));

    await as(MOVER).trade({ targetValue: 20, maxBudget: 500 });

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    expect(order.status).toBe('expired');
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });
});

describe('cancelling and closing out', () => {
  test('cancel refunds the unfilled remainder', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    const res = await as(RESTER).cancel(placed.body.id);
    expect(res.status).toBe(200);
    expect(res.body.refundedCredits).toBeCloseTo(100, 5);
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);

    // Cancelling twice must not pay twice.
    expect((await as(RESTER).cancel(placed.body.id)).status).toBe(400);
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });

  test('cancel after a partial fill refunds only what is left', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 500 });
    await as(MOVER).trade({ targetValue: 20, maxBudget: 500 });

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    const res = await as(RESTER).cancel(placed.body.id);
    expect(res.body.refundedCredits).toBeCloseTo(500 - order.filledCredits, 5);
  });

  test('another participant cannot cancel your order', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });

    const res = await request(app)
      .delete(`/api/predictions/limit-orders/${placed.body.id}`)
      .set('X-Test-Agent-Id', MOVER)
      .set('X-Workspace-Id', WS)
      .set('X-Test-Caps', 'read,trade');
    expect(res.status).toBe(403);
    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);
  });

  test("a plain trader does not see another participant's orders", async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });

    const res = await request(app)
      .get(`/api/predictions/limit-orders?agentId=${RESTER}`)
      .set('X-Test-Agent-Id', MOVER)
      .set('X-Workspace-Id', WS)
      .set('X-Test-Caps', 'read,trade');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('voiding the market refunds resting orders instead of stranding them', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);

    await voidMarket(MARKET, WS);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.status).toBe('voided');
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });
});

describe('listing', () => {
  test("lists only the caller's own open orders by default", async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    await as(MOVER).place({ direction: 'lower', limitValue: 80, budgetCredits: 100 });

    const res = await as(RESTER).list();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].direction).toBe('higher');
    expect(res.body[0].remainingCredits).toBe(100);
  });

  test('cancelled orders are hidden unless asked for', async () => {
    await seed();
    const placed = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    await as(RESTER).cancel(placed.body.id);

    expect((await as(RESTER).list()).body).toHaveLength(0);
    expect((await as(RESTER).list('?status=all')).body).toHaveLength(1);
  });
});

/**
 * Selling at a price (docs/limit-orders.md, "A sell reserves nothing, and
 * never sells more than is held"). The rule these defend: a sell order only
 * ever sells shares the participant holds at that moment, so it can never
 * overdraw a position or flip its holder to the other side.
 */
async function heldShares(agentId: string, direction: 'higher' | 'lower'): Promise<number> {
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.marketId, MARKET), eq(positions.direction, direction)));
  return (rows[0]?.shares as number | undefined) ?? 0;
}

/** RESTER buys `side` for 100 cr: higher leaves the call near 69.7, lower near 30.3. */
async function holding(side: 'higher' | 'lower'): Promise<number> {
  await seed();
  const bought = await as(RESTER).trade({ direction: side, amount: 100 });
  expect(bought.status).toBe(201);
  return heldShares(RESTER, side);
}

describe('selling at a price: placing', () => {
  test('a sell order moves no credits and no shares when it is placed', async () => {
    const held = await holding('higher');
    const balance = await balanceOf(RESTER);

    const res = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    expect(res.status).toBe(201);
    expect(res.body.side).toBe('sell');
    expect(res.body.shares).toBeCloseTo(held, 6);
    expect(res.body.filledShares).toBe(0);
    expect(res.body.remainingShares).toBeCloseTo(held, 6);
    expect(res.body.budgetCredits).toBe(0);
    expect(await balanceOf(RESTER)).toBeCloseTo(balance, 6);
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held, 6);
  });

  test('a sell order can never be for more shares than are held', async () => {
    const held = await holding('higher');
    const res = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held + 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_shares');
    expect(res.body.available).toBeCloseTo(held, 6);
  });

  test('open sell orders together can never exceed the position', async () => {
    const held = await holding('higher');
    const first = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held * 0.6 });
    expect(first.status).toBe(201);

    const second = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 85, shares: held * 0.6 });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('insufficient_shares');
    expect(second.body.available).toBeCloseTo(held * 0.4, 6);

    const fits = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 85, shares: held * 0.4 });
    expect(fits.status).toBe(201);
  });

  test('a sell order with nothing held is refused', async () => {
    await holding('higher');
    const res = await as(MOVER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_shares');
    expect(res.body.available).toBe(0);
  });

  test('a sell of the side not held is refused', async () => {
    await holding('higher');
    const res = await as(RESTER).place({ side: 'sell', direction: 'lower', limitValue: 20, shares: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_shares');
  });

  test('a sell limit the market already passed sells now down to its limit, and the rest rests', async () => {
    const held = await holding('higher');
    const before = await balanceOf(RESTER);
    const res = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 60, shares: held });
    expect(res.status).toBe(201);
    expect(res.body.filledNow.shares).toBeGreaterThan(0);
    expect(res.body.filledNow.shares).toBeLessThan(held);
    expect(await priceOf()).toBeCloseTo(60, 1);
    expect(res.body.status).toBe('open');
    expect(res.body.remainingShares).toBeCloseTo(held - res.body.filledNow.shares, 6);
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held - res.body.filledNow.shares, 6);
    expect(await balanceOf(RESTER)).toBeCloseTo(before + res.body.filledNow.proceeds, 6);
  });

  test('a crossed sell never sells more than it names, and closes filled', async () => {
    const held = await holding('higher');
    const res = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 10, shares: 20 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('filled');
    expect(res.body.filledNow.shares).toBeCloseTo(20, 6);
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held - 20, 6);
    expect(await heldShares(RESTER, 'lower')).toBe(0);
  });

  test('a crossed lower sell sells now up to its limit', async () => {
    const held = await holding('lower');
    const res = await as(RESTER).place({ side: 'sell', direction: 'lower', limitValue: 40, shares: held });
    expect(res.status).toBe(201);
    expect(await priceOf()).toBeCloseTo(40, 1);
    expect(await heldShares(RESTER, 'lower')).toBeLessThan(held);
  });

  test('side must be buy or sell, and a sell must name its shares', async () => {
    const held = await holding('higher');
    const badSide = await as(RESTER).place({ side: 'short', direction: 'higher', limitValue: 80, shares: held });
    expect(badSide.status).toBe(400);
    expect(badSide.body.error).toMatch(/side/);

    const noShares = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80 });
    expect(noShares.status).toBe(400);
    expect(noShares.body.error).toMatch(/shares/);

    const zero = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: 0 });
    expect(zero.status).toBe(400);
  });

  test('a buy placed without side answers exactly as before, plus its side', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      marketId: MARKET,
      direction: 'higher',
      limitValue: 40,
      budgetCredits: 100,
      filledCredits: 0,
      remainingCredits: 100,
      status: 'open',
      expiresAt: null,
      side: 'buy',
      shares: null,
    });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.consensusAtPlacement).toBeCloseTo(50, 5);
  });
});

describe('selling at a price: filling', () => {
  test('a higher sell fills when the price rises to its limit, and stops at the limit', async () => {
    const held = await holding('higher');
    const before = await balanceOf(RESTER);
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    expect(placed.status).toBe(201);

    const res = await as(MOVER).trade({ targetValue: 88, maxBudget: 900 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills).toHaveLength(1);
    expect(res.body.limitFills[0].side).toBe('sell');
    expect(await priceOf()).toBeCloseTo(80, 1);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    const left = await heldShares(RESTER, 'higher');
    expect(left).toBeLessThan(held);
    expect(order.filledShares).toBeCloseTo(held - left, 6);
    expect(order.filledCredits).toBeGreaterThan(0);
    expect(await balanceOf(RESTER)).toBeCloseTo(before + order.filledCredits, 6);
    expect(order.status).toBe('open');
  });

  test('every share of a sell fill sells at the limit or better', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    await as(MOVER).trade({ targetValue: 88, maxBudget: 900 });
    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    // A higher share at the $80 limit of a 0..100 range is worth 0.8.
    expect(order.filledCredits / (order.filledShares as number)).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  test('a lower sell fills when the price falls to its limit', async () => {
    const held = await holding('lower');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'lower', limitValue: 20, shares: held });
    expect(placed.status).toBe(201);

    const res = await as(MOVER).trade({ targetValue: 12, maxBudget: 900 });
    expect(res.status).toBe(201);
    expect(res.body.limitFills[0].direction).toBe('lower');
    expect(await priceOf()).toBeCloseTo(20, 1);
    expect(await heldShares(RESTER, 'lower')).toBeLessThan(held);
  });

  test('a sell order never flips its holder to the other side', async () => {
    const held = await holding('higher');
    await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 72, shares: held });
    await as(MOVER).trade({ targetValue: 99, maxBudget: 1000 });

    expect(await heldShares(RESTER, 'higher')).toBeGreaterThanOrEqual(0);
    expect(await heldShares(RESTER, 'lower')).toBe(0);
  });

  test('a sell fill never sells more than is held, even after selling by hand', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 72, shares: held });
    expect((await as(RESTER).trade({ direction: 'higher', sellShares: held / 2 })).status).toBe(201);

    const res = await as(MOVER).trade({ targetValue: 99, maxBudget: 1000 });
    expect(res.status).toBe(201);

    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(0, 6);
    expect(await heldShares(RESTER, 'lower')).toBe(0);
    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    expect(order.filledShares).toBeCloseTo(held / 2, 6);
    expect(order.status).toBe('cancelled');
  });

  test('an order whose position is gone closes when the price reaches it, selling nothing', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    expect((await as(RESTER).trade({ direction: 'higher', sellShares: held })).status).toBe(201);
    const balance = await balanceOf(RESTER);

    await as(MOVER).trade({ targetValue: 88, maxBudget: 900 });

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    expect(order.status).toBe('cancelled');
    expect(order.filledShares).toBe(0);
    expect(await balanceOf(RESTER)).toBeCloseTo(balance, 6);
  });

  test('a sell and a buy crossed by the same move both fill', async () => {
    const held = await holding('higher');
    await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    await as(MOVER).place({ direction: 'lower', limitValue: 85, budgetCredits: 50 });

    // A third participant pushes the price well past both.
    await db.insert(agents).values({ id: 'agent-third', apiKeyHash: 'h-third', balance: toUnits(2000) });
    const res = await as('agent-third').trade({ targetValue: 97, maxBudget: 2000 });
    expect(res.status).toBe(201);
    const sides = (res.body.limitFills as Array<{ side: string }>).map(f => f.side).sort();
    expect(sides).toEqual(['buy', 'sell']);
  });

  test('the sweep fills a sell the price reached with no trade to trigger it', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    // Price to about 86 without a trade, near enough that the held shares reach the limit.
    await db
      .update(markets)
      .set({ shares: [0, 363.1] })
      .where(eq(markets.id, MARKET));
    expect(await priceOf()).toBeGreaterThan(85);

    const r = await sweepLimitOrders();
    expect(r.fills).toBe(1);
    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    expect(order.filledShares).toBeGreaterThan(0);
    expect(await priceOf()).toBeCloseTo(80, 1);
  });

  test('an expired sell closes without selling', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({
      side: 'sell',
      direction: 'higher',
      limitValue: 80,
      shares: held,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await db
      .update(limitOrders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(limitOrders.id, placed.body.id));

    await as(MOVER).trade({ targetValue: 88, maxBudget: 900 });

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.id, placed.body.id));
    expect(order.status).toBe('expired');
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held, 6);
  });
});

describe('selling at a price: cancelling, closing, listing', () => {
  test('cancelling a sell refunds nothing and leaves the position as it was', async () => {
    const held = await holding('higher');
    const balance = await balanceOf(RESTER);
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });

    const res = await as(RESTER).cancel(placed.body.id);
    expect(res.status).toBe(200);
    expect(res.body.refundedCredits).toBe(0);
    expect(await balanceOf(RESTER)).toBeCloseTo(balance, 6);
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held, 6);
  });

  test('a cancelled sell frees its shares for another sell', async () => {
    const held = await holding('higher');
    const placed = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    await as(RESTER).cancel(placed.body.id);
    const again = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 85, shares: held });
    expect(again.status).toBe(201);
  });

  test('voiding the market closes a sell without paying anything twice', async () => {
    await holding('higher');
    const held = await heldShares(RESTER, 'higher');
    await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });

    await voidMarket(MARKET, WS);

    const [order] = await db.select().from(limitOrders).where(eq(limitOrders.agentId, RESTER));
    expect(order.status).toBe('voided');
    // The void refunds the 100 cr the position cost, and nothing for the order.
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });

  test('a sell order lists its side, shares and what is left', async () => {
    const held = await holding('higher');
    await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 80, shares: held });
    const res = await as(RESTER).list();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ side: 'sell', direction: 'higher', filledShares: 0 });
    expect(res.body[0].shares).toBeCloseTo(held, 6);
    expect(res.body[0].remainingShares).toBeCloseTo(held, 6);
  });

  test('a buy order lists as a buy with no shares', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 });
    const res = await as(RESTER).list();
    expect(res.body[0]).toMatchObject({ side: 'buy', shares: null, filledShares: null, remainingShares: null });
  });
});

/**
 * Your own orders never trade against each other (docs/limit-orders.md). A
 * higher buy and a lower sell pull the price up; a lower buy and a higher
 * sell pull it down. Two of one participant's orders pulling opposite ways,
 * with the up-pull's limit above the down-pull's, are both crossed at every
 * price between, and each fill crosses the other again. On the snake on
 * 2026-09-13 one such pair filled 885 times in 55 seconds.
 */
describe('your own orders never trade against each other', () => {
  test('an order that would trade against your own resting order is refused, and nothing is reserved or traded', async () => {
    await seed();
    const resting = await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 });
    expect(resting.status).toBe(201);
    expect(resting.body.status).toBe('open');

    // A lower buy over 40 is crossed at 50 and would fill down to 40, through the higher buy under 45.
    const res = await as(RESTER).place({ direction: 'lower', limitValue: 40, budgetCredits: 100 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('crosses_own_order');
    expect(res.body.orderId).toBe(resting.body.id);

    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);
    expect(await priceOf()).toBeCloseTo(50, 5);
    expect(await db.select().from(limitOrders)).toHaveLength(1);
    expect(await heldShares(RESTER, 'lower')).toBe(0);
    expect(await heldShares(RESTER, 'higher')).toBe(0);
  });

  test('a higher buy above your own resting lower buy is refused', async () => {
    await seed();
    const resting = await as(RESTER).place({ direction: 'lower', limitValue: 55, budgetCredits: 100 });
    expect(resting.body.status).toBe('open');
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 100 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('crosses_own_order');
    expect(await balanceOf(RESTER)).toBeCloseTo(900, 5);
  });

  test('a higher sell below your own resting higher buy is refused', async () => {
    const held = await holding('higher');
    const resting = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 100 });
    expect(resting.body.status).toBe('open');
    const before = await priceOf();
    const res = await as(RESTER).place({ side: 'sell', direction: 'higher', limitValue: 55, shares: held / 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('crosses_own_order');
    expect(await heldShares(RESTER, 'higher')).toBeCloseTo(held, 6);
    expect(await priceOf()).toBeCloseTo(before, 6);
  });

  test('a lower sell above your own resting lower buy is refused', async () => {
    const held = await holding('lower');
    const resting = await as(RESTER).place({ direction: 'lower', limitValue: 40, budgetCredits: 100 });
    expect(resting.body.status).toBe('open');
    const res = await as(RESTER).place({ side: 'sell', direction: 'lower', limitValue: 45, shares: held / 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('crosses_own_order');
    expect(await heldShares(RESTER, 'lower')).toBeCloseTo(held, 6);
  });

  test('your orders pulling opposite ways with the limits apart both rest', async () => {
    await seed();
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 })).status).toBe(201);
    expect((await as(RESTER).place({ direction: 'lower', limitValue: 55, budgetCredits: 100 })).status).toBe(201);
  });

  test('equal limits do not conflict', async () => {
    await seed();
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 })).status).toBe(201);
    expect((await as(RESTER).place({ direction: 'lower', limitValue: 45, budgetCredits: 100 })).status).toBe(201);
  });

  test('your orders pulling the same way never conflict', async () => {
    await seed();
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 })).status).toBe(201);
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 100 })).status).toBe(201);
  });

  test('a cancelled order no longer conflicts', async () => {
    await seed();
    const resting = await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 });
    expect((await as(RESTER).cancel(resting.body.id)).status).toBe(200);
    expect((await as(RESTER).place({ direction: 'lower', limitValue: 40, budgetCredits: 100 })).status).toBe(201);
  });

  test("another participant's crossing order is not refused", async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 });
    expect((await as(MOVER).place({ direction: 'lower', limitValue: 40, budgetCredits: 100 })).status).toBe(201);
  });

  test('two opposing orders of one participant do not trade back and forth hundreds of times', async () => {
    // A pair that rests from before the rule existed: the fill pass itself must not loop on it.
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 300 });
    await db.insert(limitOrders).values({
      id: 'order-pre-rule-lower',
      workspaceId: WS,
      marketId: MARKET,
      agentId: RESTER,
      side: 'buy',
      direction: 'lower',
      limitValue: 40,
      budgetCredits: 300,
      filledCredits: 0,
      status: 'open',
    });
    await db
      .update(agents)
      .set({ balance: toUnits(400) })
      .where(eq(agents.id, RESTER));

    const r = await sweepLimitOrders();
    expect(r.fills).toBeLessThanOrEqual(2);
  });
});

describe('the fill pass fills each order once per pass', () => {
  test("two participants' crossing orders each fill once per pass, not back and forth until a budget runs out", async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 500 });
    // Fills at once down to 40, which fills RESTER back up to 45 and leaves MOVER's order crossed.
    const placed = await as(MOVER).place({ direction: 'lower', limitValue: 40, budgetCredits: 500 });
    expect(placed.status).toBe(201);

    const r = await sweepLimitOrders();
    expect(r.fills).toBe(2);
    const orders = await db.select().from(limitOrders);
    for (const o of orders) expect(o.status).toBe('open');
  });
});

describe('the market is locked before its orders', () => {
  function firstLock(queries: string[], table: string): number {
    return queries.findIndex(q => new RegExp(`from "${table}"[\\s\\S]*for update`, 'i').test(q));
  }

  test('the sweep locks the market before any resting order, so a decision voiding the book cannot deadlock against it', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 });
    const capture = captureQueries();
    try {
      await sweepLimitOrders();
    } finally {
      capture.stop();
    }
    const market = firstLock(capture.queries, 'markets');
    const orders = firstLock(capture.queries, 'limit_orders');
    expect(orders).toBeGreaterThanOrEqual(0);
    expect(market).toBeGreaterThanOrEqual(0);
    expect(market).toBeLessThan(orders);
  });

  test('releasing a closing book locks the market before its orders', async () => {
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 45, budgetCredits: 100 });
    const capture = captureQueries();
    try {
      await db.transaction(async tx => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await releaseLimitOrdersForMarket(tx as any, MARKET, 'cancelled');
      });
    } finally {
      capture.stop();
    }
    const market = firstLock(capture.queries, 'markets');
    const orders = firstLock(capture.queries, 'limit_orders');
    expect(orders).toBeGreaterThanOrEqual(0);
    expect(market).toBeGreaterThanOrEqual(0);
    expect(market).toBeLessThan(orders);
  });
});
