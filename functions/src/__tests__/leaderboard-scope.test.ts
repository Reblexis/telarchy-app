/**
 * GET /api/leaderboard, and what it counts.
 *
 * Two things are defended here. The privacy contract: only public workspaces
 * are aggregated, ever. And the scope (owner report 2026-08-15, "why are the
 * contractors per workspace and traders globally sorted? it should all be per
 * workspace"): a floor's own rail asks for one workspace and must get only
 * that workspace's trading, while /leaderboard asks for all of them.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/leaderboard', leaderboardRouter);

beforeAll(async () => {
  await ensureMigrations();
});
// The board is cached in process (five seconds), so a test that seeds new
// data must drop the previous test's answer or it reads a board that no
// longer exists.
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
});

const ALPHA = 'ws-alpha';
const BETA = 'ws-beta';
const PRIVATE = 'ws-private';

/**
 * Three workspaces, one trader each, every trader holding a winning position
 * so their profit is unmistakably non-zero and attributable to one place.
 */
async function seed() {
  await db.insert(agents).values([
    { id: 'alpha-trader', apiKeyHash: 'h-alpha', balance: toUnits(1000), nickname: 'alpha' },
    { id: 'beta-trader', apiKeyHash: 'h-beta', balance: toUnits(1000), nickname: 'beta' },
    { id: 'private-trader', apiKeyHash: 'h-priv', balance: toUnits(1000), nickname: 'priv' },
  ]);
  await db.insert(workspaces).values([
    { id: ALPHA, name: 'Alpha', slug: 'alpha', createdBy: 'alpha-trader', visibility: 'public' },
    { id: BETA, name: 'Beta', slug: 'beta', createdBy: 'beta-trader', visibility: 'public' },
    { id: PRIVATE, name: 'Private', slug: 'private', createdBy: 'private-trader', visibility: 'private' },
  ]);

  for (const [ws, agentId] of [
    [ALPHA, 'alpha-trader'],
    [BETA, 'beta-trader'],
    [PRIVATE, 'private-trader'],
  ] as const) {
    await db.insert(metrics).values({
      id: `metric-${ws}`,
      workspaceId: ws,
      name: 'Revenue',
      value: 50,
      formula: '0',
      marketRangeMax: 100,
    });
    await db.insert(markets).values({
      id: `mkt-${ws}`,
      workspaceId: ws,
      metricId: `metric-${ws}`,
      metricName: 'Revenue',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 100,
      // The book holds the shares the position below holds: an open position
      // is valued at what this book would pay to take it back (docs/seasons.md
      // F1), so a market claiming zero outstanding shares would value it at
      // nothing.
      shares: [0, 80],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
    // Paid 10 for 40 shares the book would pay about 19 to take back: a real
    // gain, in this workspace and nowhere else. (80 outstanding, because the
    // cross-workspace test adds a second holder to Beta's book.)
    await db.insert(positions).values({
      id: `pos-${ws}`,
      workspaceId: ws,
      agentId,
      marketId: `mkt-${ws}`,
      direction: 'higher',
      shares: 40,
      totalCost: 10,
    });
    await db.insert(trades).values({
      id: `trade-${ws}`,
      workspaceId: ws,
      agentId,
      marketId: `mkt-${ws}`,
      direction: 'higher',
      shares: 40,
      cost: 10,
      createdAt: new Date(),
    });
  }
}

const board = async (query = '') => {
  const res = await request(app).get(`/api/leaderboard${query}`);
  expect(res.status).toBe(200);
  return res.body.participants as Array<{ id: string; totalEarnings: number; totalTrades: number }>;
};

describe('scope', () => {
  test('with no scope it ranks across every public workspace', async () => {
    await seed();
    const rows = await board();
    expect(rows.map(r => r.id).sort()).toEqual(['alpha-trader', 'beta-trader']);
  });

  test('a workspace id ranks only that workspace', async () => {
    await seed();
    const rows = await board(`?workspaceId=${ALPHA}`);
    expect(rows.map(r => r.id)).toEqual(['alpha-trader']);
    expect(rows[0].totalEarnings).toBeGreaterThan(0);
  });

  test('a slug works too, case-insensitively, since floors are addressed by slug', async () => {
    await seed();
    expect((await board('?workspaceId=beta')).map(r => r.id)).toEqual(['beta-trader']);
    expect((await board('?workspaceId=BETA')).map(r => r.id)).toEqual(['beta-trader']);
  });

  test('a trader active in two workspaces is counted per workspace, not once', async () => {
    await seed();
    // The same account also trades on Beta.
    await db.insert(positions).values({
      id: 'pos-cross',
      workspaceId: BETA,
      agentId: 'alpha-trader',
      marketId: `mkt-${BETA}`,
      direction: 'higher',
      shares: 40,
      totalCost: 10,
    });
    await db.insert(trades).values({
      id: 'trade-cross',
      workspaceId: BETA,
      agentId: 'alpha-trader',
      marketId: `mkt-${BETA}`,
      direction: 'higher',
      shares: 40,
      cost: 10,
      createdAt: new Date(),
    });

    const onAlpha = (await board(`?workspaceId=${ALPHA}`)).find(r => r.id === 'alpha-trader')!;
    const onBeta = (await board(`?workspaceId=${BETA}`)).find(r => r.id === 'alpha-trader')!;
    const global = (await board()).find(r => r.id === 'alpha-trader')!;

    expect(onAlpha.totalTrades).toBe(1);
    expect(onBeta.totalTrades).toBe(1);
    expect(global.totalTrades).toBe(2);
    // Each scope reports the profit earned there; the global board sums them.
    // Within a cent per scope: profit is rounded to cents once per board, so
    // two scoped boards can round in the same direction and the global one
    // cannot land on their exact sum.
    expect(Math.abs(global.totalEarnings - (onAlpha.totalEarnings + onBeta.totalEarnings))).toBeLessThanOrEqual(0.02);
  });

  test('a private workspace is never aggregated, scoped or not', async () => {
    await seed();
    expect((await board()).map(r => r.id)).not.toContain('private-trader');
    // Naming it explicitly answers empty rather than widening to everything.
    expect(await board(`?workspaceId=${PRIVATE}`)).toEqual([]);
    expect(await board('?workspaceId=private')).toEqual([]);
  });

  test('an unknown scope answers empty, never the whole platform', async () => {
    await seed();
    expect(await board('?workspaceId=does-not-exist')).toEqual([]);
  });
});
