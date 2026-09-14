/**
 * The public profile reads what it shows, not everything the participant ever
 * did (docs/infra/deploy.md, "Per-participant reads are keyed by the
 * participant").
 *
 * GET /api/agents/:idOrNickname/public shows 20 recent trades, 25 open
 * positions, the floors a participant trades on and a realized-profit line. It
 * read every trade, every position and every touched market of the
 * participant into the process to do that; a bot on a floor that opens a book
 * a second has hundreds of thousands of each. The answer is pinned here along
 * with the bound.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, positions, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { clearBoardCache } from '../routes/leaderboard';
import { captureQueries, largest } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);

const KAI = 'kai';
const WS = 'ws-profile-main';
const OLD_WS = 'ws-profile-old';
const OPEN = 60;
const SETTLED = 60;
const TRADES_PER_MARKET = 3;
const T0 = Date.parse('2026-06-01T00:00:00Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  await seed();
});

function book(id: string, workspaceId: string, over: Partial<typeof markets.$inferInsert> = {}) {
  return {
    id,
    workspaceId,
    metricId: `metric-${workspaceId}`,
    metricName: 'Score',
    targetDate: '2030-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 6] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    tradedVolume: 3,
    ...over,
  };
}

async function seed() {
  await db.insert(agents).values([
    { id: KAI, apiKeyHash: 'h-kai', balance: toUnits(1000), nickname: 'kai' },
    { id: 'owner', apiKeyHash: 'h-owner', balance: 0 },
  ]);
  for (const wsId of [WS, OLD_WS]) {
    await provisionWorkspace(db as any, {
      wsId,
      name: wsId,
      createdBy: 'owner',
      ownerAgentId: 'owner',
      visibility: 'public',
    });
    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
    const trader = groups.find(g => g.type === 'trader')!;
    await db
      .update(permissionGroups)
      .set({ memberIds: [KAI] })
      .where(eq(permissionGroups.id, trader.id));
    await db
      .insert(metrics)
      .values({ id: `metric-${wsId}`, workspaceId: wsId, name: 'Score', value: 0, formula: '0', marketRangeMax: 100 });
  }

  const books = [
    ...Array.from({ length: OPEN }, (_, i) => book(`open-${i}`, WS)),
    ...Array.from({ length: SETTLED }, (_, i) =>
      book(`settled-${i}`, WS, {
        resolved: true,
        actualValue: 70,
        active: false,
        resolvedAt: new Date(T0 + (i + 1) * 86_400_000),
      }),
    ),
    book('old-open', OLD_WS),
  ];
  await db.insert(markets).values(books);

  const tradeRows: (typeof trades.$inferInsert)[] = [];
  let t = 0;
  for (const b of books.filter(b => b.workspaceId === WS)) {
    for (let k = 0; k < TRADES_PER_MARKET; k++) {
      t += 1;
      tradeRows.push({
        id: `t-${String(t).padStart(4, '0')}`,
        workspaceId: WS,
        agentId: KAI,
        marketId: b.id,
        direction: 'higher',
        shares: 2,
        cost: 1,
        kind: 'trade',
        createdAt: new Date(T0 + t * 60_000),
      });
    }
  }
  // The only trace kai left on the old floor is its very first trade.
  tradeRows.push({
    id: 't-oldest',
    workspaceId: OLD_WS,
    agentId: KAI,
    marketId: 'old-open',
    direction: 'higher',
    shares: 1,
    cost: 1,
    kind: 'trade',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  });
  for (let i = 0; i < tradeRows.length; i += 200) await db.insert(trades).values(tradeRows.slice(i, i + 200));

  await db.insert(positions).values(
    books
      .filter(b => b.workspaceId === WS)
      .map(b => ({
        id: `${KAI}_${b.id}_higher`,
        workspaceId: WS,
        agentId: KAI,
        marketId: b.id,
        direction: 'higher',
        shares: 6,
        totalCost: 3,
      })),
  );
}

const profile = () => request(app).get(`/api/agents/${KAI}/public`);

test('it still shows the 20 newest trades, 25 open positions, every floor traded on, and one profit step per settled market', async () => {
  const res = await profile();
  expect(res.status).toBe(200);
  const newest = Array.from(
    { length: 20 },
    (_, i) => `t-${String((OPEN + SETTLED) * TRADES_PER_MARKET - i).padStart(4, '0')}`,
  );
  expect(res.body.recentTrades.map((r: { id: string }) => r.id)).toEqual(newest);
  expect(res.body.openPositions).toHaveLength(25);
  expect(res.body.openPositions.every((p: { status: string }) => p.status === 'open')).toBe(true);
  expect(res.body.activeWorkspaces.map((w: { id: string }) => w.id).sort()).toEqual([OLD_WS, WS].sort());
  expect(res.body.stats.totalTrades).toBe((OPEN + SETTLED) * TRADES_PER_MARKET + 1);
  const pnl = res.body.pnlHistory as { at: string; cumulative: number }[];
  expect(pnl).toHaveLength(SETTLED);
  // Every settled market made the same step, so the line ends at SETTLED times the first.
  expect(pnl[pnl.length - 1].cumulative).toBeCloseTo(pnl[0].cumulative * SETTLED, 1);
  expect(pnl.map(p => p.at)).toEqual([...pnl.map(p => p.at)].sort());
}, 60_000);

test('no statement answers every trade, position or market of the participant', async () => {
  // Warm the board cache first: the board is the leaderboard's own read, and
  // what is bounded here is the profile's.
  await profile();
  const log = captureQueries();
  try {
    expect((await profile()).status).toBe(200);
  } finally {
    log.stop();
  }
  const l = largest(log.stats);
  // 361 trades, 120 positions, 121 markets; one row per settled market (60)
  // is the most the profile needs.
  expect(l ? `${l.rows} rows: ${l.sql.slice(0, 160)}` : 'no queries').toMatch(/^(\d|[1-5]\d|60) rows/);
}, 60_000);
