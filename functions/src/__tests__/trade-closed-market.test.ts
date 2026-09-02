/**
 * HTTP-level tests for the trade route's closed-market behavior.
 *
 * Sells on a closed market are allowed (so participants can exit positions
 * before the target date arrives); buys on a closed market are rejected with
 * a clear error. Both flows go through the real express app and auth
 * middleware so the test exercises the public proposal.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The real auth middleware imports better-auth (ESM-only) which jest can't
// load through ts-jest. The trade gate we're testing doesn't depend on the
// auth path — only on req.auth being populated. Mock the middleware to set
// req.auth from test headers so we exercise the route's actual logic.
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
import { agentApiKeys, agents, markets, metrics, permissionGroups, positions } from '../db/schema';
import { initialPool, sharesForBudget } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware, hashKey } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// Mirror the error handler from app.ts so AppError → status + JSON body.
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

const WS = 'ws-trade-closed';
const OWNER = 'agent-owner';
const BETTOR = 'agent-bettor';
const BETTOR_KEY = 'test-bettor-raw-key';
const METRIC = 'metric-act';
const MARKET = 'market-2026-04';
// A period that has NOT ended. `closed` means deactivated by the time
// preference while an honest answer is still coming, which is why a sell
// is allowed: the holder is getting out BEFORE the target date arrives, as
// the header above says. This fixture used a past period, which only
// behaved as `closed` because nothing gated on the clock; a market past its
// resolution instant is `settling` now and trades in neither direction
// (docs/market-integrity.md, "Trading stops when the answer is fixed").
const TARGET = '2099-04';

const RANGE_MIN = 0;
const RANGE_MAX = 100;
const LIQUIDITY = 10;
const BETTOR_START_CREDITS = 1000;

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
    { id: BETTOR, apiKeyHash: hashKey(BETTOR_KEY), balance: toUnits(BETTOR_START_CREDITS) },
  ]);
  // The pglite transaction type doesn't structurally match the production
  // node-postgres transaction type that provisionWorkspace declares. The
  // runtime operations are identical, so cast to bypass the compile-time gate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Trade Closed Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    // 'public': this suite is about TRADING, and trading needs a published
    // floor now (docs/guides/creating.md). The value used to be 'private'
    // and was incidental - nothing here tests visibility.
    visibility: 'public',
  });

  const traderRows = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const traderGroup = traderRows.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BETTOR] })
    .where(eq(permissionGroups.id, traderGroup.id));

  await db.insert(agentApiKeys).values({
    hash: hashKey(BETTOR_KEY),
    keyId: 'key-1',
    agentId: BETTOR,
    workspaceId: WS,
    label: 'test',
    scopes: ['*'],
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: RANGE_MAX,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: TARGET,
    rangeMin: RANGE_MIN,
    rangeMax: RANGE_MAX,
    shares: [0, 0],
    liquidity: LIQUIDITY,
    pool: initialPool(LIQUIDITY),
    active: true,
    resolved: false,
    voided: false,
  });
}

/** Helper: place a buy directly via the trade route (used to build a position before deactivating). */
async function buyHigher(budget: number) {
  return request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', BETTOR)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, direction: 'higher', amount: budget });
}

describe('trade route on closed markets', () => {
  test('sell on closed market succeeds and reduces position shares', async () => {
    await seed();

    // 1. Build a position while the market is open.
    const buy = await buyHigher(50);
    expect(buy.status).toBe(201);
    const sharesBought = buy.body.shares as number;
    expect(sharesBought).toBeGreaterThan(0);

    // 2. Deactivate (simulate TP refresh removing this date from the sample).
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));

    // 3. Sell half — must be allowed.
    const sellAmount = sharesBought / 2;
    const sell = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', BETTOR)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', sellShares: sellAmount });
    expect(sell.status).toBe(201);
    expect(sell.body.proceeds).toBeGreaterThan(0);

    const [pos] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, `${BETTOR}_${MARKET}_higher`));
    expect(pos.shares).toBeCloseTo(sharesBought - sellAmount, 6);
  });

  test('buy on closed market is rejected with a clear error', async () => {
    await seed();
    await buyHigher(10); // small position so we exist
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));

    const buy = await buyHigher(20);
    expect(buy.status).toBe(400);
    expect(String(buy.body.error)).toMatch(/closed/i);
    expect(String(buy.body.error)).toMatch(/sell/i);
  });

  test('targetValue trade on closed market is rejected (same gate as direct buy)', async () => {
    await seed();
    await buyHigher(10);
    await db.update(markets).set({ active: false }).where(eq(markets.id, MARKET));

    const tv = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', BETTOR)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, targetValue: 60, maxBudget: 5 });
    expect(tv.status).toBe(400);
    expect(String(tv.body.error)).toMatch(/closed/i);
  });

  test('sell on a resolved market is rejected', async () => {
    await seed();
    await buyHigher(50);
    await db.update(markets).set({ resolved: true, active: false }).where(eq(markets.id, MARKET));

    const sell = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', BETTOR)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', sellShares: 1 });
    expect(sell.status).toBe(400);
    expect(String(sell.body.error)).toMatch(/resolved/i);
  });

  test('sell on a voided market is rejected', async () => {
    await seed();
    await buyHigher(50);
    await db.update(markets).set({ voided: true, active: false }).where(eq(markets.id, MARKET));

    const sell = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', BETTOR)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send({ marketId: MARKET, direction: 'higher', sellShares: 1 });
    expect(sell.status).toBe(400);
    expect(String(sell.body.error)).toMatch(/voided/i);
  });

  // Quiets the unused-import linter for sharesForBudget — kept available for
  // future tests that compare proceeds against expected LMSR math.
  void sharesForBudget;
});
