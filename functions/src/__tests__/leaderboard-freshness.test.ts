/**
 * The board must not lag the trades it ranks (owner report 2026-08-21: "the
 * leaderboard seems kinda laggy.. not always showing the latest most
 * uptodate state").
 *
 * Two guarantees, each of which failed against the previous 30-second cache:
 *
 *  1. A trade placed through the trade route is on the board on the very next
 *     read, because the route drops the board cache after its transaction
 *     commits. The floor rail reloads right after a trade lands, so a cached
 *     answer that omits the trade reads as the board being broken.
 *  2. A trade written by anyone else (another instance, a bot, settlement) is
 *     on the board within the cache TTL, which is five seconds: under the
 *     floor's fifteen-second poll, so two successive polls can never
 *     alternate between a fresh answer and a stale one.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The real auth middleware imports better-auth (ESM-only) which jest can't
// load through ts-jest. The board itself is public; the trade route only
// needs req.auth populated, so the mock reads it from test headers.
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
import { agents, markets, metrics, permissionGroups, positions, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/leaderboard', leaderboardRouter);
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
  clearBoardCache();
});
afterEach(() => {
  jest.restoreAllMocks();
});

const WS = 'ws-freshness';
const OWNER = 'agent-owner';
const BETTOR = 'agent-bettor';
const METRIC = 'metric-fresh';
const MARKET = 'market-fresh';

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
    { id: BETTOR, apiKeyHash: 'h-bettor', balance: toUnits(1000), nickname: 'bettor' },
  ]);
  // Public: the board aggregates public workspaces only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Freshness Test',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const traderGroup = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BETTOR] })
    .where(eq(permissionGroups.id, traderGroup.id));
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 200,
    pool: initialPool(200),
    active: true,
    resolved: false,
    voided: false,
  });
}

const board = async () => {
  const res = await request(app).get('/api/leaderboard');
  expect(res.status).toBe(200);
  return res.body.participants as Array<{ id: string; totalTrades: number }>;
};

test('a trade placed through the route is on the board on the very next read', async () => {
  await seed();
  // Warm the cache with the pre-trade answer, exactly what a viewer sitting
  // on the page has just done.
  expect(await board()).toEqual([]);

  const trade = await request(app)
    .post('/api/predictions/trade')
    .set('X-Test-Agent-Id', BETTOR)
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ marketId: MARKET, direction: 'higher', amount: 20 });
  expect(trade.status).toBe(201);

  // No cache expiry, no waiting: the route invalidated the board.
  const rows = await board();
  expect(rows.map(r => r.id)).toContain(BETTOR);
  expect(rows.find(r => r.id === BETTOR)!.totalTrades).toBe(1);
});

test('a trade written outside the route is on the board within five seconds', async () => {
  await seed();
  expect(await board()).toEqual([]);

  // A background writer this process never sees: another instance, a bot run,
  // a settlement. Rows only, no invalidation.
  await db.insert(positions).values({
    id: `pos-${MARKET}`,
    workspaceId: WS,
    agentId: BETTOR,
    marketId: MARKET,
    direction: 'higher',
    shares: 40,
    totalCost: 10,
  });
  await db.insert(trades).values({
    id: `trade-${MARKET}`,
    workspaceId: WS,
    agentId: BETTOR,
    marketId: MARKET,
    direction: 'higher',
    shares: 40,
    cost: 10,
    createdAt: new Date(),
  });

  // Still inside the TTL: the cached answer stands. This is the cache doing
  // its job under a burst, not the bug.
  expect(await board()).toEqual([]);

  // Six seconds later the entry has expired. Against the old 30-second TTL
  // this read still answered stale, which under a 15-second poll made the
  // board alternate between fresh and stale answers.
  const realNow = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => realNow + 6_000);
  const rows = await board();
  expect(rows.map(r => r.id)).toContain(BETTOR);
});
