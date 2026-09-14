/**
 * The ticket's landing against the real server, end to end.
 *
 * docs/limit-orders.md, "A quote lands where the price comes to rest": the
 * ticket reads the resting orders off the prices read and runs the fill pass
 * on them (src/lib/limit-fills.ts). The server runs the real pass inside the
 * trade and the sweep finishes whatever that pass left. The two live in
 * different source trees, so only a test that drives both can hold them
 * together: every scenario below composes a trade the way the ticket does,
 * places it for real, sweeps until nothing fills, and checks the book rests
 * where the ticket said, to the cent.
 *
 * Asked (Viktor, 2026-09-14): "make sure that when placing a  trade in the ui
 * and whatnot it properly shows the actual final impact on the price
 * considering also the limit orders in place".
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, limitOrders, markets, metrics, permissionGroups, positions } from '../db/schema';
import { consensus, initialPool, pHigher, sharesForBudget } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { predictionsRouter } from '../routes/predictions';
import { sweepLimitOrders } from '../services/trading';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

// The app bundle's simulator, required rather than imported: it lives outside
// this package's rootDir (the same way agent-builder-connection.test.ts reads src/).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { settleThroughOrders } = require('../../../src/lib/limit-fills');

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use(apiErrorHandler);

const WS = 'ws-landing';
const OWNER = 'agent-landing-owner';
const MOVER = 'agent-mover';
const R1 = 'agent-rest-1';
const R2 = 'agent-rest-2';
const MARKET = 'm-landing';
const B = 200;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-lo', balance: toUnits(0) },
    { id: MOVER, apiKeyHash: 'h-lm', balance: toUnits(5000) },
    { id: R1, apiKeyHash: 'h-l1', balance: toUnits(5000) },
    { id: R2, apiKeyHash: 'h-l2', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Landing',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));
  await db.insert(metrics).values({
    id: 'metric-landing',
    workspaceId: WS,
    name: 'Length',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-landing',
    metricName: 'Length',
    targetDate: '2099',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
  });
}

const as = (agentId: string) => ({
  trade: (body: Record<string, unknown>) =>
    request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', agentId)
      .set('X-Workspace-Id', WS)
      .send({ marketId: MARKET, ...body }),
  place: (body: Record<string, unknown>) =>
    request(app)
      .post('/api/predictions/limit-orders')
      .set('X-Test-Agent-Id', agentId)
      .set('X-Workspace-Id', WS)
      .send({ marketId: MARKET, ...body }),
});

async function ok(r: request.Test) {
  const res = await r;
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function bookNow(): Promise<[number, number]> {
  const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
  return m.shares as [number, number];
}

async function heldBy(agentId: string): Promise<{ higher: number; lower: number }> {
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.marketId, MARKET)));
  return {
    higher: (rows.find(r => r.direction === 'higher')?.shares as number) ?? 0,
    lower: (rows.find(r => r.direction === 'lower')?.shares as number) ?? 0,
  };
}

/**
 * Compose a trade the way the ticket does (the trade's own landing, then the
 * fill pass on the orders from the prices read), place it for real, sweep to
 * rest, and compare. Returns both prices so a scenario can prove the orders
 * mattered at all.
 */
async function landing(
  agentId: string,
  trade: { direction: 'higher' | 'lower'; amount?: number; sellShares?: number },
) {
  const prices = await ok(request(app).get(`/api/marketplace/${WS}/prices`));
  const orders = prices.books.find((b: { marketId: string }) => b.marketId === MARKET).orders;

  const book = await bookNow();
  const d = trade.direction === 'higher' ? 1 : 0;
  const before = await heldBy(agentId);
  const after = { ...before };
  const moved: [number, number] = [book[0], book[1]];
  if (trade.sellShares !== undefined) {
    moved[d] -= trade.sellShares;
    after[trade.direction] -= trade.sellShares;
  } else {
    const bought = sharesForBudget(book, d, trade.amount!, B).amount;
    moved[d] += bought;
    after[trade.direction] += bought;
    const pairs = Math.min(after.higher, after.lower);
    after.higher -= pairs;
    after.lower -= pairs;
  }
  const own = await db
    .select({ id: limitOrders.id })
    .from(limitOrders)
    .where(and(eq(limitOrders.agentId, agentId), eq(limitOrders.status, 'open')));

  const shown: number = settleThroughOrders({
    prob: pHigher(moved, B),
    liquidity: B,
    rangeMin: 0,
    rangeMax: 100,
    orders,
    heldChange: {
      orderIds: own.map(o => o.id),
      higher: after.higher - before.higher,
      lower: after.lower - before.lower,
    },
  });

  await ok(as(agentId).trade(trade));
  for (let i = 0; i < 20; i++) if ((await sweepLimitOrders()).fills === 0) break;

  return {
    ownLanding: consensus(moved, B, 0, 100)!,
    shown: Math.round(shown * 100 * 100) / 100,
    rested: consensus(await bookNow(), B, 0, 100)!,
  };
}

describe('THE TICKET SHOWS WHERE THE PRICE COMES TO REST', () => {
  test('a buy through one resting order', async () => {
    await ok(as(R1).place({ direction: 'lower', limitValue: 55, budgetCredits: 500 }));
    const r = await landing(MOVER, { direction: 'higher', amount: 80 });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test('a buy through an order too small to reach its limit', async () => {
    await ok(as(R1).place({ direction: 'lower', limitValue: 52, budgetCredits: 3 }));
    const r = await landing(MOVER, { direction: 'higher', amount: 80 });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(0.1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test('a buy through a resting sell that runs out of shares', async () => {
    await ok(as(R1).trade({ direction: 'higher', amount: 20 }));
    const held = (await heldBy(R1)).higher;
    await ok(as(R1).place({ side: 'sell', direction: 'higher', limitValue: 60, shares: held }));
    const r = await landing(MOVER, { direction: 'higher', amount: 150 });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test('orders on both sides from two participants, crossed in turn', async () => {
    await ok(as(R1).place({ direction: 'higher', limitValue: 45, budgetCredits: 10 }));
    await ok(as(R1).place({ direction: 'higher', limitValue: 42, budgetCredits: 400 }));
    await ok(as(R2).place({ direction: 'lower', limitValue: 58, budgetCredits: 15 }));
    const r = await landing(MOVER, { direction: 'lower', amount: 120 });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test('a sale through a resting buy', async () => {
    await ok(as(MOVER).trade({ direction: 'higher', amount: 200 }));
    await ok(as(R1).place({ direction: 'higher', limitValue: 55, budgetCredits: 300 }));
    const held = (await heldBy(MOVER)).higher;
    const r = await landing(MOVER, { direction: 'higher', sellShares: held });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test("the trader's own resting sell sells what the trader's buy adds", async () => {
    await ok(as(MOVER).trade({ direction: 'higher', amount: 30 }));
    const held = (await heldBy(MOVER)).higher;
    await ok(as(MOVER).place({ side: 'sell', direction: 'higher', limitValue: 62, shares: held }));
    // Sell half by hand: the order still wants all of it, the position holds half.
    await ok(as(MOVER).trade({ direction: 'higher', sellShares: held / 2 }));
    const r = await landing(MOVER, { direction: 'higher', amount: 150 });
    expect(Math.abs(r.ownLanding - r.rested)).toBeGreaterThan(1);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });

  test('a buy that crosses nothing rests where it lands', async () => {
    await ok(as(R1).place({ direction: 'lower', limitValue: 95, budgetCredits: 50 }));
    const r = await landing(MOVER, { direction: 'higher', amount: 10 });
    expect(r.rested).toBe(r.ownLanding);
    expect(Math.abs(r.shown - r.rested)).toBeLessThanOrEqual(0.01);
  });
});
