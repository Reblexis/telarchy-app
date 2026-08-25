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

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, limitOrders, markets, metrics, positions, workspaces } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { voidMarket } from '../services/markets';
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

const WS = 'ws-limit';
const RESTER = 'agent-rester';
const MOVER = 'agent-mover';
const MARKET = 'market-limit-2028';

async function seed(cap = 0) {
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
  await db.update(workspaces).set({ maxPositionCostPerMarket: cap }).where(eq(workspaces.id, WS));
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

  test('an already-crossed order is refused as the market order it is', async () => {
    await seed();
    // Market sits at 50. "Buy higher while at or below 60" is true right now.
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 60, budgetCredits: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/would fill immediately/);
    expect(res.body.consensus).toBeCloseTo(50, 5);
    expect(await balanceOf(RESTER)).toBeCloseTo(1000, 5);
  });

  test('a limit outside the market range is refused', async () => {
    await seed();
    const res = await as(RESTER).place({ direction: 'higher', limitValue: 120, budgetCredits: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/strictly between/);
  });

  test('reserved credits count against the position cap', async () => {
    await seed(50);
    expect((await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 40 })).status).toBe(201);

    // 40 reserved leaves 10 of the 50 cap, so a 20-credit buy must fail.
    const res = await as(RESTER).trade({ direction: 'higher', amount: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Position cap/);
    expect(res.body.spent).toBeCloseTo(40, 5);
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
    // A cap tightened after placement is the realistic way an order ends up
    // with no headroom: the reservation was legal when made and is not now.
    // The order is left resting; the stranger's trade must still stand.
    await seed();
    await as(RESTER).place({ direction: 'higher', limitValue: 40, budgetCredits: 500 });
    await db.insert(positions).values({
      id: `${RESTER}_${MARKET}_higher`,
      workspaceId: WS,
      agentId: RESTER,
      marketId: MARKET,
      direction: 'higher',
      shares: 0,
      totalCost: 400,
    });
    await db.update(workspaces).set({ maxPositionCostPerMarket: 300 }).where(eq(workspaces.id, WS));

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
