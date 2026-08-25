/**
 * HTTP-level test for GET /api/predictions/markets/:id/trades consensus replay.
 *
 * The per-trade "Result" / chart series is reconstructed server-side, not
 * stored. Liquidity injections rescale the whole share vector (and b) between
 * trades, so a naive sum of trade shares drifts from the real market.shares and
 * the final replayed point disagrees with the live market consensus. This was a
 * visible bug: the trade log showed 768.93 while the header showed 790.
 *
 * The replay now interleaves liquidity events, so the final point equals the
 * live consensus computed from the current market row.
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
import { agents, markets, metrics, permissionGroups } from '../db/schema';
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
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-trade-hist';
const OWNER = 'agent-owner-hist';
const TRADER = 'agent-trader-hist';
const METRIC = 'metric-hist';
const MARKET = 'market-hist-2028';

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-hist', balance: toUnits(1000), platformAdmin: true },
    { id: TRADER, apiKeyHash: 'h-trader-hist', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Trade History',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
  const traderGroup = (await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS))).find(
    g => g.type === 'trader',
  )!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [TRADER] })
    .where(eq(permissionGroups.id, traderGroup.id));
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Fears',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Fears',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 1000,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

const buy = (budget: number) =>
  request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', TRADER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, direction: 'higher', amount: budget });

const inject = (amount: number) =>
  request(app)
    .post(`/api/predictions/markets/${MARKET}/liquidity`)
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ amount });

describe('trade history consensus replay across liquidity injections', () => {
  test('final replayed point equals live market consensus after an injection between trades', async () => {
    await seed();

    // Mirror real markets: liquidity is injected before any trade, and a
    // further injection lands between two trades (rescaling the first trade's
    // shares). No trade ever precedes the market's first injection.
    expect((await inject(15)).status).toBe(200);
    expect((await buy(40)).status).toBe(201);
    expect((await inject(15)).status).toBe(200);
    expect((await buy(40)).status).toBe(201);

    const res = await request(app)
      .get(`/api/predictions/markets/${MARKET}/trades`)
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);

    // Live consensus computed from the current market row is the ground truth.
    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const live = consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax)!;

    const lastReplayed = res.body[res.body.length - 1].consensus as number;
    expect(lastReplayed).toBeCloseTo(live, 2);
  });

  test('without any injection the replay still matches the live consensus', async () => {
    await seed();
    expect((await buy(30)).status).toBe(201);
    expect((await buy(20)).status).toBe(201);

    const res = await request(app)
      .get(`/api/predictions/markets/${MARKET}/trades`)
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS);
    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET));
    const live = consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax)!;
    expect(res.body[res.body.length - 1].consensus as number).toBeCloseTo(live, 2);
  });
});
