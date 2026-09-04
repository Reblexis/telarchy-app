/**
 * The detail a public profile carries per position and per trade
 * (docs/ui-conventions.md, "The participant profile"): the balance, each
 * position's worth and profit at the board's mark, each trade's price per
 * share and the call before and after it, the workspace slug every row
 * links back through, and the credits traded.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: async (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, positions, trades, workspaces } from '../db/schema';
import { initialPool, pHigher } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const OWNER = 'kai';
const WS_OWNER = 'creator';
const WS = 'ws-detail';
const B = 10;
const BOOK: [number, number] = [0, 4];

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-kai', balance: toUnits(1234.5) },
    { id: WS_OWNER, apiKeyHash: 'h-c', balance: toUnits(0) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Detail Floor',
    createdBy: WS_OWNER,
    ownerAgentId: WS_OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [OWNER] })
    .where(eq(permissionGroups.id, trader.id));

  await db
    .insert(metrics)
    .values({ id: 'metric-d', workspaceId: WS, name: 'Users', value: 0, formula: '0', marketRangeMax: 100 });
  await db.insert(markets).values({
    id: 'mkt-d',
    workspaceId: WS,
    metricId: 'metric-d',
    metricName: 'Users',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: BOOK,
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
  });
  await db.insert(positions).values({
    id: 'pos-d',
    agentId: OWNER,
    workspaceId: WS,
    marketId: 'mkt-d',
    direction: 'higher',
    shares: 5,
    totalCost: 2,
  });
  const t0 = new Date('2026-09-01T10:00:00Z');
  const t1 = new Date('2026-09-02T10:00:00Z');
  const t2 = new Date('2026-09-03T10:00:00Z');
  await db.insert(trades).values([
    // Written before the call was recorded: nulls, never zeros.
    {
      id: 't-old',
      agentId: OWNER,
      workspaceId: WS,
      marketId: 'mkt-d',
      direction: 'higher',
      shares: 8,
      cost: 3,
      createdAt: t0,
    },
    // A sell (stored negative) that recorded its move.
    {
      id: 't-sell',
      agentId: OWNER,
      workspaceId: WS,
      marketId: 'mkt-d',
      direction: 'higher',
      shares: -3,
      cost: -1.5,
      consensusBefore: 60,
      consensusAfter: 55,
      createdAt: t1,
    },
    // A redemption pair: not a trade, and no move.
    {
      id: 'r-h',
      agentId: OWNER,
      workspaceId: WS,
      marketId: 'mkt-d',
      direction: 'higher',
      shares: -1,
      cost: -0.6,
      kind: 'redeem',
      createdAt: t2,
    },
    {
      id: 'r-l',
      agentId: OWNER,
      workspaceId: WS,
      marketId: 'mkt-d',
      direction: 'lower',
      shares: -1,
      cost: -0.4,
      kind: 'redeem',
      createdAt: t2,
    },
  ]);
}

describe('GET /api/agents/:idOrNickname/public detail', () => {
  test('carries the tradeable balance as a number', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBeCloseTo(1234.5, 6);
  });

  test('a position carries worth and profit at the board mark', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    const [p] = res.body.openPositions;
    const factor = pHigher(BOOK, B);
    // Rounded to cents, like every credit figure the API prints.
    expect(p.worth).toBeCloseTo(5 * factor, 2);
    expect(p.profit).toBeCloseTo(5 * factor - 2, 2);
    // ...and the sum of position profits is the open profit on the strip.
    expect(res.body.stats.openEarnings).toBeCloseTo(p.profit, 2);
  });

  test('every position and trade names the workspace slug it links through', async () => {
    await seed();
    const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, WS));
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(ws.slug).toBeTruthy();
    for (const p of res.body.openPositions) expect(p.workspaceSlug).toBe(ws.slug);
    for (const t of res.body.recentTrades) expect(t.workspaceSlug).toBe(ws.slug);
  });

  test('a trade carries its price per share, and the call before and after when recorded', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    const byId = new Map(res.body.recentTrades.map((t: { id: string }) => [t.id, t]));
    const old = byId.get('t-old') as Record<string, unknown>;
    expect(old.price).toBeCloseTo(3 / 8, 9);
    expect(old.consensusBefore).toBeNull();
    expect(old.consensusAfter).toBeNull();
    const sell = byId.get('t-sell') as Record<string, unknown>;
    expect(sell.kind).toBe('sell');
    expect(sell.price).toBeCloseTo(1.5 / 3, 9);
    expect(sell.consensusBefore).toBe(60);
    expect(sell.consensusAfter).toBe(55);
  });

  test('a redemption has no price and no move', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    const redeem = res.body.recentTrades.find((t: { kind: string }) => t.kind === 'redeem');
    expect(redeem).toBeTruthy();
    expect(redeem.price).toBeNull();
    expect(redeem.consensusBefore).toBeNull();
    expect(redeem.consensusAfter).toBeNull();
  });

  test('stats.tradedVolume is the credits moved by buys and sells, redemptions excluded', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${OWNER}/public`);
    expect(res.body.stats.tradedVolume).toBeCloseTo(3 + 1.5, 6);
  });
});
