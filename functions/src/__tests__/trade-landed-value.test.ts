/**
 * The value a trade response reports IS the value the market landed on
 * (owner report 2026-08-22: "when I trade, the new value shown isn't the
 * actual value it gets traded to"). The client previews are pinned to the
 * server AMM in src/lib/__tests__/amm-parity.test.ts; this suite pins the
 * server's own half of the promise through the real trade route against a
 * real database:
 *
 *  - the response's consensus equals the consensus derived from the book
 *    the market actually stored, netting included;
 *  - a {targetValue, maxBudget} trade LANDS on the target when the budget
 *    covers it, held positions and buybacks included;
 *  - when resting limit orders fill behind a trade, settledConsensus is
 *    where the market actually came to rest.
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
import { agents, markets, metrics } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
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

const WS = 'ws-landed';
const TRADER = 'agent-landed';
const OTHER = 'agent-landed-2';
const MARKET = 'market-landed';

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-owner-landed', apiKeyHash: 'h-owner-landed', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-landed', balance: toUnits(1000) },
    { id: OTHER, apiKeyHash: 'h-landed-2', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Landed Value Test',
    createdBy: 'agent-owner-landed',
    ownerAgentId: 'agent-owner-landed',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-landed',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-landed',
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

function trade(body: Record<string, unknown>, agentId = TRADER) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', agentId)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });
}

/** The consensus derived from the book the market actually stored. */
async function storedConsensus(): Promise<number> {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, MARKET), eq(markets.workspaceId, WS)));
  return consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax)!;
}

describe('the response consensus is the stored book, redemption included', () => {
  test('a plain buy reports where the book actually is', async () => {
    await seed();
    const res = await trade({ direction: 'higher', amount: 100 });
    expect(res.status).toBe(201);
    expect(res.body.consensus).toBeCloseTo(await storedConsensus(), 6);
  });

  test('a contrarian bet reports the landing its own size earns', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const before = await storedConsensus();
    const res = await trade({ direction: 'lower', amount: 25 });
    expect(res.status).toBe(201);
    const landed = await storedConsensus();
    expect(res.body.consensus).toBeCloseTo(landed, 6);
    // 25 credits of lower moves the price down by 25 credits' worth, and
    // the redemption of the matched pairs moves it by nothing (it takes
    // the same amount off both sides). Under the liquidation this replaced
    // the same bet dumped the whole 100-credit position and landed below
    // the midpoint (owner ask 2026-08-30, docs/ui-conventions.md).
    expect(landed).toBeLessThan(before);
    expect(landed).toBeGreaterThan(50);
  });

  test('a sell reports the post-sell landing', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const res = await trade({ direction: 'higher', sellShares: 10 });
    expect(res.status).toBe(201);
    expect(res.body.consensus).toBeCloseTo(await storedConsensus(), 6);
  });
});

describe('a targetValue trade lands ON the target (budget permitting)', () => {
  test('with no held position', async () => {
    await seed();
    const res = await trade({ targetValue: 70, maxBudget: 10_000 });
    expect(res.status).toBe(201);
    expect(await storedConsensus()).toBeCloseTo(70, 1);
    expect(res.body.consensus).toBeCloseTo(70, 1);
  });

  test('with a held opposite position: still lands on the target', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 100 });
    const res = await trade({ targetValue: 30, maxBudget: 10_000 });
    expect(res.status).toBe(201);
    expect(await storedConsensus()).toBeCloseTo(30, 1);
  });

  test('a target below the live price buys lower, held position or not', () => {
    // The buyback case is gone with the liquidation that caused it (owner
    // ask 2026-08-30). It used to be: holding higher, a target of 55 below
    // a live 60 meant the route sold the whole position (price fell to
    // 50) and then bought HIGHER back up to 55. Redemption moves no price,
    // so 55 below 60 is reached the obvious way, by buying lower.
    return (async () => {
      await seed();
      await trade({ direction: 'higher', amount: 200 });
      const live = await storedConsensus();
      expect(live).toBeGreaterThan(55); // the premise of the case
      const res = await trade({ targetValue: 55, maxBudget: 10_000 });
      expect(res.status).toBe(201);
      expect(res.body.direction).toBe('lower');
      expect(await storedConsensus()).toBeCloseTo(55, 1);
    })();
  });

  test('budget-capped: spends the budget, stops short, and reports the true landing', async () => {
    await seed();
    const res = await trade({ targetValue: 95, maxBudget: 5 });
    expect(res.status).toBe(201);
    expect(res.body.cost).toBeLessThanOrEqual(5 + 1e-6);
    const landed = await storedConsensus();
    expect(landed).toBeLessThan(95);
    expect(landed).toBeGreaterThan(50);
    expect(res.body.consensus).toBeCloseTo(landed, 6);
  });
});

describe('when resting orders fill behind a trade, settledConsensus is the rest point', () => {
  test('the response separates "where my trade put it" from "where it settled"', async () => {
    await seed();
    // OTHER rests a buy-higher order that fills once the price drops to 40.
    const placed = await request(app)
      .post('/api/predictions/limit-orders')
      .set('X-Test-Agent-Id', OTHER)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', limitValue: 40, budgetCredits: 50 });
    expect(placed.status).toBe(201);

    // TRADER shoves the price well below 40; the resting order fills in the
    // same transaction and buys it back up toward 40.
    const res = await trade({ targetValue: 20, maxBudget: 10_000 });
    expect(res.status).toBe(201);
    expect(res.body.consensus).toBeCloseTo(20, 1);
    expect(Array.isArray(res.body.limitFills)).toBe(true);
    expect(res.body.limitFills.length).toBeGreaterThan(0);
    // settledConsensus is where the market actually came to rest, which is
    // what the stored book says, and it is NOT the trade's own post-price.
    expect(res.body.settledConsensus).toBeCloseTo(await storedConsensus(), 6);
    expect(res.body.settledConsensus).not.toBeCloseTo(res.body.consensus, 1);
  });
});
