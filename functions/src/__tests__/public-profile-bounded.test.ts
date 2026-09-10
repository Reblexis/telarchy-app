/**
 * A PARTICIPANT'S PROFILE READS THEIR OWN ROWS, NOT EVERY PUBLIC FLOOR.
 *
 * `GET /api/agents/:idOrNickname/public` used to load every non-voided
 * market, every trade, every position and every voided market of every
 * public workspace to answer for one participant (telarchy umbrella,
 * notes/snake-load-audit-2026-09-10.md, item 8), on a public, uncached
 * endpoint every leaderboard row links to. It now takes the site-wide
 * figures (rank, profit, calibration) from the board the leaderboard
 * serves, and everything else from queries filtered by `agent_id`.
 *
 * The numbers must not move: the profile's stats strip promises to show the
 * leaderboard's number (docs/ui-conventions.md, "The stats strip"). So the
 * fixture has trades in two public workspaces and the assertions are the
 * formula's answers, not whatever the endpoint printed before.
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

import express from 'express';
import request from 'supertest';
import { agents, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool, pHigher } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { captureQueries, largest, widest } from './harness/query-log';
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

const WS_A = 'ws-prof-a';
const WS_B = 'ws-prof-b';
const KAI = 'kai';
const BO = 'bo';
const B = 10;
const OPEN_BOOK: [number, number] = [0, 5];
const OPEN_BOOK_B: [number, number] = [0, 2];
const RESOLVED_AT = new Date('2026-09-05T00:00:00Z');
const UNTRADED = 3_000;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

function market(overrides: Partial<typeof markets.$inferInsert> & { id: string; workspaceId: string }) {
  return {
    metricId: 'metric',
    metricName: 'Users',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    ...overrides,
  };
}

async function seed() {
  await db.insert(workspaces).values([
    { id: WS_A, name: 'Floor A', slug: 'floor-a', createdBy: 'owner', visibility: 'public' },
    { id: WS_B, name: 'Floor B', slug: 'floor-b', createdBy: 'owner', visibility: 'public' },
  ]);
  await db.insert(agents).values([
    { id: KAI, apiKeyHash: 'h-kai', balance: toUnits(100) },
    { id: BO, apiKeyHash: 'h-bo', balance: toUnits(100) },
  ]);
  await db.insert(markets).values([
    market({ id: 'm-open', workspaceId: WS_A, shares: OPEN_BOOK }),
    market({
      id: 'm-resolved',
      workspaceId: WS_A,
      resolved: true,
      actualValue: 80,
      resolvedAt: RESOLVED_AT,
      shares: [10, 10],
    }),
    market({ id: 'm-voided', workspaceId: WS_B, voided: true, resolved: true, resolvedAt: RESOLVED_AT }),
    market({ id: 'm-open-b', workspaceId: WS_B, shares: OPEN_BOOK_B }),
  ]);
  await db.insert(positions).values([
    { id: 'p1', agentId: KAI, workspaceId: WS_A, marketId: 'm-open', direction: 'higher', shares: 5, totalCost: 2 },
    {
      id: 'p2',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'higher',
      shares: 10,
      totalCost: 3,
    },
    { id: 'p3', agentId: BO, workspaceId: WS_A, marketId: 'm-resolved', direction: 'lower', shares: 10, totalCost: 6 },
    { id: 'p4', agentId: BO, workspaceId: WS_B, marketId: 'm-open-b', direction: 'higher', shares: 2, totalCost: 1 },
    // Sold out: still "active" on the floor, never an open position.
    { id: 'p5', agentId: KAI, workspaceId: WS_B, marketId: 'm-open-b', direction: 'higher', shares: 0, totalCost: 1 },
  ]);
  const at = (d: string) => new Date(d);
  await db.insert(trades).values([
    {
      id: 't1',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-open',
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: at('2026-09-01T10:00:00Z'),
    },
    {
      id: 't2',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'higher',
      shares: 10,
      cost: 3,
      createdAt: at('2026-09-02T10:00:00Z'),
    },
    {
      id: 't3',
      agentId: BO,
      workspaceId: WS_A,
      marketId: 'm-resolved',
      direction: 'lower',
      shares: 10,
      cost: 6,
      createdAt: at('2026-09-02T11:00:00Z'),
    },
    {
      id: 't4',
      agentId: KAI,
      workspaceId: WS_B,
      marketId: 'm-voided',
      direction: 'higher',
      shares: 6,
      cost: 4,
      createdAt: at('2026-09-03T10:00:00Z'),
    },
    {
      id: 't5',
      agentId: BO,
      workspaceId: WS_B,
      marketId: 'm-open-b',
      direction: 'higher',
      shares: 2,
      cost: 1,
      createdAt: at('2026-09-03T11:00:00Z'),
    },
    // kai bought and sold out on floor B: two trades, net cash 0.5.
    {
      id: 't6',
      agentId: KAI,
      workspaceId: WS_B,
      marketId: 'm-open-b',
      direction: 'higher',
      shares: 1,
      cost: 1,
      createdAt: at('2026-09-04T10:00:00Z'),
    },
    {
      id: 't7',
      agentId: KAI,
      workspaceId: WS_B,
      marketId: 'm-open-b',
      direction: 'higher',
      shares: -1,
      cost: -0.5,
      createdAt: at('2026-09-04T11:00:00Z'),
    },
    // A redemption: not a trade for the traded figure.
    {
      id: 'r1',
      agentId: KAI,
      workspaceId: WS_A,
      marketId: 'm-open',
      direction: 'higher',
      shares: -1,
      cost: -0.1,
      kind: 'redeem',
      createdAt: at('2026-09-05T10:00:00Z'),
    },
  ]);
}

async function seedUntraded(n: number) {
  const rows: Array<typeof markets.$inferInsert> = [];
  for (let i = 0; i < n; i++) {
    const state = i % 3;
    rows.push(
      market({
        id: `quiet-${i}`,
        workspaceId: i % 2 === 0 ? WS_A : WS_B,
        ...(state === 0
          ? { voided: true, resolved: true, resolvedAt: RESOLVED_AT }
          : state === 1
            ? { resolved: true, actualValue: 40 + (i % 50), resolvedAt: RESOLVED_AT }
            : {}),
        proposalId: state === 2 ? null : `prop-${i}`,
        branch: state === 2 ? null : i % 2 === 0 ? 'approved' : 'declined',
      }),
    );
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(markets).values(rows.slice(i, i + 500));
}

async function profile(id: string) {
  const res = await request(app).get(`/api/agents/${id}/public`);
  expect(res.status).toBe(200);
  // The live balance and profit points carry the request instant.
  const { balanceHistory: _b, profitHistory, ...rest } = res.body;
  return { ...rest, profitHistory: (profitHistory as Array<{ profit: number }>).map(p => p.profit) };
}

describe("A PARTICIPANT'S PROFILE READS THEIR OWN ROWS, NOT EVERY PUBLIC FLOOR", () => {
  test('the stats strip is the formula over both floors', async () => {
    const p = await profile(KAI);
    const f = pHigher(OPEN_BOOK, B);
    // Settled: 10 higher paid 0.8 = 8, plus the void refund of 4, minus the
    // net cash on those two markets (3 + 4). Open: 5 shares at the live
    // factor, minus 2 paid on the open book, minus 0.5 net on the sold-out
    // one, minus the redemption's -0.1 (netCash counts every ledger row).
    const settled = 8 + 4 - 7;
    const open = 5 * f - 2 - 0.5 + 0.1;
    expect(p.stats.settledEarnings).toBeCloseTo(settled, 2);
    expect(p.stats.openEarnings).toBeCloseTo(open, 2);
    expect(p.stats.totalEarnings).toBeCloseTo(settled + open, 2);
    // Every ledger row counts as a trade; the traded figure skips the
    // redemption: 2 + 3 + 4 + 1 + 0.5.
    expect(p.stats.totalTrades).toBe(6);
    expect(p.stats.tradedVolume).toBeCloseTo(10.5, 2);
    expect(p.stats.lastTradeAt).toBe('2026-09-05T10:00:00.000Z');
    // One resolved market held, higher paid 0.8: calibration 0.8, accuracy 1.
    expect(p.stats.resolvedMarkets).toBe(1);
    expect(p.stats.calibration).toBeCloseTo(0.8, 6);
    expect(p.stats.accuracy).toBe(1);
    // bo: 10 lower paid 0.2 = 2, plus 2 higher on floor B at its call,
    // minus 7. Below kai either way.
    expect(p.stats.rank).toBe(1);
    expect((await profile(BO)).stats.rank).toBe(2);
    expect(p.activeWorkspaces.map((w: { id: string }) => w.id).sort()).toEqual([WS_A, WS_B]);
    expect(p.openPositions.map((o: { marketId: string }) => o.marketId).sort()).toEqual(['m-open', 'm-resolved']);
    expect(p.recentTrades).toHaveLength(6);
    expect(p.pnlHistory).toHaveLength(1);
  });

  test(`the profile is identical with and without ${UNTRADED} untraded markets on both floors`, async () => {
    const before = await profile(KAI);
    const beforeBo = await profile(BO);
    await seedUntraded(UNTRADED);
    expect(await profile(KAI)).toEqual(before);
    expect(await profile(BO)).toEqual(beforeBo);
  }, 120_000);

  test('no statement returns the floor: every read is bounded by what this participant did', async () => {
    await seedUntraded(UNTRADED);
    const log = captureQueries();
    try {
      await profile(KAI);
    } finally {
      log.stop();
    }
    const w = widest(log.stats);
    expect(w ? `${w.params} params: ${w.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|[1-4]\d) params/);
    const l = largest(log.stats);
    // Eight trades, five positions, four traded markets: nothing on this
    // page needs a hundred rows of anything.
    expect(l ? `${l.rows} rows: ${l.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|[1-9]\d) rows/);
  }, 120_000);
});
