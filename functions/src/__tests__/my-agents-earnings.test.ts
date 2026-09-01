/**
 * What each agent you own has actually earned, in the call that lists them.
 *
 * `GET /api/agents/mine` returned an id and a balance. A balance says how much
 * an agent has left, which is not the question an owner is asking: they want to
 * know whether the thing is any good, and whether it has done anything at all.
 * The funnel says 94 owned bots have registered and none has ever traded, so
 * for most rows the honest answer is "nothing yet", and a list that cannot say
 * that is a list nobody looks at twice.
 *
 * The numbers come from `lib/board.ts`, the same module the leaderboard ranks
 * on, deliberately: an owner's private view of their bot and the bot's public
 * rank must not be able to disagree.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        uid: req.headers['x-test-uid'] || null,
        agentId: req.headers['x-test-agent-id'] || null,
        workspaceId: req.headers['x-workspace-id'] || null,
        capabilities: new Set(['read', 'trade']),
        scopes: ['*'],
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, markets, metrics, permissionGroups, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { clearBoardCache } from '../routes/leaderboard';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

const WS = 'ws-mine-earn';
const UID = 'u-mine';
const ME = 'me-participant';
const WINNER = 'my-winner-bot';
const IDLE = 'my-idle-bot';
const STRANGER = 'not-mine';
const METRIC = 'metric-mine';
const MARKET = 'market-mine';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(authUser).values([{ id: UID, name: 'Me', email: 'me@example.com' }]);
  await db.insert(agents).values([
    { id: ME, apiKeyHash: 'h-me', balance: toUnits(500), authUserId: UID },
    { id: WINNER, apiKeyHash: 'h-winner', balance: toUnits(120), ownerUserId: UID },
    { id: IDLE, apiKeyHash: 'h-idle', balance: toUnits(25), ownerUserId: UID },
    { id: STRANGER, apiKeyHash: 'h-stranger', balance: toUnits(999) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Mine',
    createdBy: ME,
    ownerAgentId: ME,
    visibility: 'public',
  });
  await db.update(workspaces).set({ slug: 'mine' }).where(eq(workspaces.id, WS));
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const pub = groups.find(g => g.type === 'public')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [ME, WINNER, IDLE] })
    .where(eq(permissionGroups.id, pub.id));

  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 40,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [10, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
  // One bot has traded and holds a position; the other has done nothing.
  await db.insert(trades).values({
    id: 't-winner',
    workspaceId: WS,
    agentId: WINNER,
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    cost: 4,
    kind: 'trade',
    createdAt: new Date('2026-08-30T10:00:00Z'),
  });
  await db.insert(positions).values({
    id: `${WINNER}_${MARKET}_higher`,
    workspaceId: WS,
    agentId: WINNER,
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    totalCost: 4,
  });
}

const mine = () => request(app).get('/api/agents/mine').set('X-Test-Uid', UID);

describe('the list of agents you own', () => {
  test('still carries the id and balance it always did', async () => {
    const res = await mine();
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((a: { id: string }) => [a.id, a]));
    expect(byId[WINNER].balance).toBe(120);
    expect(byId[IDLE].balance).toBe(25);
  });

  test('THE POINT: each one says what it has earned, not only what it has left', async () => {
    const res = await mine();
    const winner = res.body.find((a: { id: string }) => a.id === WINNER);
    expect(typeof winner.earned).toBe('number');
    expect(winner.settledEarnings + winner.openEarnings).toBeCloseTo(winner.earned, 6);
  });

  test('an agent that has never traded says so, rather than looking like a loss', async () => {
    // The common case: 94 owned bots, none of which has ever traded.
    const res = await mine();
    const idle = res.body.find((a: { id: string }) => a.id === IDLE);
    expect({ earned: idle.earned, totalTrades: idle.totalTrades, lastTradeAt: idle.lastTradeAt }).toEqual({
      earned: 0,
      totalTrades: 0,
      lastTradeAt: null,
    });
  });

  test('a working agent reports its trade count and when it last acted', async () => {
    const res = await mine();
    const winner = res.body.find((a: { id: string }) => a.id === WINNER);
    expect(winner.totalTrades).toBe(1);
    expect(String(winner.lastTradeAt)).toContain('2026-08-30');
  });

  test('THE RULE: it lists only agents you own, and never anybody else', async () => {
    const res = await mine();
    const ids = res.body.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual([IDLE, ME, WINNER].sort());
    expect(ids).not.toContain(STRANGER);
  });

  test('the owner sees their own participant beside the bots', async () => {
    const res = await mine();
    const me = res.body.find((a: { id: string }) => a.id === ME);
    expect(me).toBeDefined();
    expect(me.balance).toBe(500);
  });
});
