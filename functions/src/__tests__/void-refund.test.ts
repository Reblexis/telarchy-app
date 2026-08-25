/**
 * What a void pays back.
 *
 * The rule (owner decision 2026-08-15, docs/vision.md "a void refunds net
 * cash, not gross cost"): every participant gets back the net cash they still
 * had in the market, floored at zero. Until that date the refund was
 * `positions.totalCost`, the cumulative BUY cost, which a sell never reduces,
 * so buying and selling the same shares back handed the buy cost over again.
 * That was live: an account round-tripped 5 credits twice on the LookPilot
 * floor and the void minted it 10 credits.
 *
 * Defended here because it is settlement, i.e. real balances: the money a
 * cancel returns, and the money it must never invent or take away.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, positions, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
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
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-void';
const TRADER = 'agent-void-trader';
const MARKET = 'market-void-2028';
const START = 1000;

async function seed() {
  await db.insert(agents).values([
    { id: 'agent-owner-void', apiKeyHash: 'h-owner-void', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-void-trader', balance: toUnits(START) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Void Test',
    createdBy: 'agent-owner-void',
    ownerAgentId: 'agent-owner-void',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-void',
    workspaceId: WS,
    name: 'Throughput',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-void',
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

const trade = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, ...body });

async function balance(): Promise<number> {
  const [row] = await db.select().from(agents).where(eq(agents.id, TRADER));
  return fromUnits(row.balance as number);
}

/** Shares currently held. `amount` on a buy is CREDITS to spend, while a sell
 *  takes SHARES, so a round trip has to read back what the buy produced. */
async function heldShares(): Promise<number> {
  const [pos] = await db.select().from(positions).where(eq(positions.agentId, TRADER));
  return pos ? pos.shares : 0;
}

/** Buy for `credits`, then sell every share it produced. */
async function roundTrip(credits: number): Promise<void> {
  const before = await heldShares();
  const buy = await trade({ direction: 'higher', amount: credits });
  expect(buy.status).toBe(201);
  const gained = (await heldShares()) - before;
  const sell = await trade({ direction: 'higher', sellShares: gained });
  expect(sell.status).toBe(201);
}

describe('what a void refunds', () => {
  test('a holder gets back exactly what they put in', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 40 });
    const afterBuy = await balance();
    expect(afterBuy).toBeLessThan(START);

    await voidMarket(MARKET, WS);
    expect(await balance()).toBeCloseTo(START, 4);
  });

  test('a break-even round trip is refunded nothing, and mints nothing', async () => {
    await seed();
    // Buy, sell it all back, twice: the shares are gone and the cash is
    // already home, so a cancel owes this account nothing.
    await roundTrip(5);
    await roundTrip(5);
    const beforeVoid = await balance();
    // LMSR is path independent, so a full round trip returns the cash exactly.
    expect(beforeVoid).toBeCloseTo(START, 4);
    expect(await heldShares()).toBeCloseTo(0, 6);

    await voidMarket(MARKET, WS);

    // The pre-2026-08-15 rule refunded positions.totalCost here, which two
    // round trips had grown to the sum of both buys: free credits.
    expect(await balance()).toBeCloseTo(beforeVoid, 4);
    expect(await balance()).toBeLessThanOrEqual(START + 1e-6);
  });

  test('the gross buy cost is still on the position row, and is not what gets paid', async () => {
    await seed();
    await roundTrip(15);
    const [pos] = await db.select().from(positions).where(eq(positions.agentId, TRADER));
    // Selling decrements shares only: totalCost stays gross on purpose, so
    // churning cannot stretch the position cap. That is exactly why the
    // refund cannot read it.
    expect(pos.shares).toBeCloseTo(0, 6);
    expect(pos.totalCost).toBeGreaterThan(0);

    await voidMarket(MARKET, WS);
    expect(await balance()).toBeCloseTo(START, 4);
  });

  test('a partly sold position is refunded only what is still in it', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 40 });
    const half = (await heldShares()) / 2;
    await trade({ direction: 'higher', sellShares: half });
    const beforeVoid = await balance();

    const { refunded } = await voidMarket(MARKET, WS);
    const stillIn = START - beforeVoid;
    expect(refunded).toBeCloseTo(stillIn, 1);
    expect(await balance()).toBeCloseTo(START, 1);
  });

  test('a void never debits an account', async () => {
    await seed();
    // Buy, then push the price up with a second buy and sell out above cost,
    // so the account has taken more out than it put in.
    await trade({ direction: 'higher', amount: 40 });
    await trade({ direction: 'higher', amount: 120 });
    await trade({ direction: 'higher', sellShares: await heldShares() });
    const beforeVoid = await balance();

    await voidMarket(MARKET, WS);
    // Whatever the sign of their net cash, the cancel takes nothing back.
    expect(await balance()).toBeGreaterThanOrEqual(beforeVoid - 1e-6);
  });

  test('the market is marked voided and stops accepting trades', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 10 });
    await voidMarket(MARKET, WS);

    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    expect(m.voided).toBe(true);
    expect(m.resolved).toBe(true);
    expect(m.actualValue).toBeNull();

    const after = await trade({ direction: 'higher', amount: 5 });
    expect(after.status).toBe(400);
    // A void marks the market resolved as well, and the resolved guard is
    // the one that answers first; either wording means "no more trading".
    expect(after.body.error).toMatch(/resolved|voided/i);
  });

  test('voiding twice does not pay twice', async () => {
    await seed();
    await trade({ direction: 'higher', amount: 40 });
    await voidMarket(MARKET, WS);
    const afterFirst = await balance();

    const second = await voidMarket(MARKET, WS);
    expect(second.refunded).toBe(0);
    expect(await balance()).toBeCloseTo(afterFirst, 6);
  });
});

describe('workspace balances stay conserved', () => {
  test('a cancel returns credits to traders without inventing any', async () => {
    await seed();
    const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, WS));
    expect(wsRow).toBeTruthy();

    await trade({ direction: 'higher', amount: 30 });
    await trade({ direction: 'higher', sellShares: (await heldShares()) / 3 });
    const traderBefore = await balance();

    const { refunded } = await voidMarket(MARKET, WS);
    const traderAfter = await balance();

    // Every credit the trader receives is a credit the void reported paying.
    expect(traderAfter - traderBefore).toBeCloseTo(refunded, 4);
    // And it never exceeds what they had at stake.
    expect(traderAfter).toBeLessThanOrEqual(START + 1e-6);
  });
});
