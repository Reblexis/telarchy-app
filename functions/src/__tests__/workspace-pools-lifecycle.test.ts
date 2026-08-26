/**
 * A workspace pool against a real database (docs/workspace-pools.md): the
 * month starts and freezes its rules, settles once on settled outcomes only,
 * pays the eligible, excludes insiders and their payout twins, rolls an
 * undistributable pool forward, and never recomputes.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, markets, payouts, trades, workspacePoolResults, workspacePools, workspaces } from '../db/schema';
import { resolutionPayouts } from '../lib/amm';
import {
  addToScheduledPool,
  computePoolBoard,
  payoutSummary,
  rulesMarkdown,
  settleDuePools,
  startDuePools,
} from '../services/workspacePools';
import { ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-1';
const SEPT = '2026-09';
const startOfSept = new Date(Date.UTC(2026, 8, 1));
const startOfOct = new Date(Date.UTC(2026, 9, 1));
const day = (d: number) => new Date(Date.UTC(2026, 8, d, 12));

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    {
      id: 'owner',
      apiKeyHash: 'h1',
      balance: 0,
      nickname: 'owner',
      payoutMethod: { provider: 'paypal', email: 'owner@x.com' },
    },
    {
      id: 'alice',
      apiKeyHash: 'h2',
      balance: 0,
      nickname: 'alice',
      payoutMethod: { provider: 'paypal', email: 'alice@x.com' },
    },
    { id: 'bob', apiKeyHash: 'h3', balance: 0, nickname: 'bob' },
    {
      id: 'twin',
      apiKeyHash: 'h4',
      balance: 0,
      nickname: 'twin',
      payoutMethod: { provider: 'paypal', email: 'OWNER@x.com' },
    },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'W', slug: 'w', createdBy: 'owner', visibility: 'public' });
  const base = {
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Revenue',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 0,
    pool: 0,
    active: false,
    resolved: true,
    voided: false,
    proposalId: null,
  };
  await db.insert(markets).values([
    { ...base, id: 'sept-a', targetDate: '2026-09-15', resolvedAt: day(16), actualValue: 80 },
    { ...base, id: 'sept-b', targetDate: '2026-09-25', resolvedAt: day(26), actualValue: 80 },
    { ...base, id: 'oct', targetDate: '2026-09-30', resolvedAt: new Date(Date.UTC(2026, 9, 2)), actualValue: 80 },
  ]);
  await addToScheduledPool(db, WS, SEPT, 10_000);
});

/** `n` buys of one higher share at `cost` each, spread over two markets from day 3. */
async function buys(agentId: string, n: number, cost: number, ids = ['sept-a', 'sept-b'], tag = '') {
  await db.insert(trades).values(
    Array.from({ length: n }, (_, i) => ({
      id: `${agentId}${tag}-${i}`,
      workspaceId: WS,
      agentId,
      marketId: ids[i % ids.length],
      direction: 'higher',
      shares: 1,
      cost,
      createdAt: day(3 + (i % 20)),
    })),
  );
}

test('the month starts once, freezes its rules, and a running pool refuses more money', async () => {
  const before = await startDuePools(new Date(Date.UTC(2026, 7, 31)));
  expect(before.started).toEqual([]);
  const started = await startDuePools(startOfSept);
  expect(started.started).toEqual([`${WS}/${SEPT}`]);
  const [pool] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, SEPT)));
  expect(pool.status).toBe('running');
  const rules = pool.rules as { totalCents: number; month: string };
  expect(rules.totalCents).toBe(10_000);
  expect(rulesMarkdown(pool.rules as Parameters<typeof rulesMarkdown>[0])).toContain('$100.00');
  await expect(addToScheduledPool(db, WS, SEPT, 1)).rejects.toThrow(/fixed/);
  expect((await startDuePools(startOfSept)).started).toEqual([]);
});

test('settlement pays the eligible on settled outcomes only, excludes insiders and twins, and never recomputes', async () => {
  const [, higherPay] = resolutionPayouts(80, 0, 100);
  await buys('alice', 12, 0.5); // 12 shares worth higherPay each, paid 6
  await buys('bob', 2, 0.5); // under the floor
  await buys('owner', 12, 0.5);
  await buys('twin', 12, 0.5);
  // Alice also trades the market that resolves in October: not counted.
  await db.insert(trades).values({
    id: 'alice-oct',
    workspaceId: WS,
    agentId: 'alice',
    marketId: 'oct',
    direction: 'higher',
    shares: 100,
    cost: 1,
    createdAt: day(20),
  });
  await startDuePools(startOfSept);

  const live = await computePoolBoard(WS, SEPT);
  expect(live?.final).toBe(false);
  const liveAlice = live?.entries.find(e => e.agentId === 'alice');
  expect(liveAlice?.score).toBeCloseTo(12 * higherPay - 6, 2);

  expect((await settleDuePools(day(30))).settled).toEqual([]); // month not over
  const settled = await settleDuePools(startOfOct);
  expect(settled.settled).toEqual([`${WS}/${SEPT}`]);

  const board = await computePoolBoard(WS, SEPT);
  expect(board?.final).toBe(true);
  const byId = Object.fromEntries((board?.entries ?? []).map(e => [e.agentId, e]));
  expect(byId.alice.eligible).toBe(true);
  expect(byId.alice.payoutCents).toBe(10_000);
  expect(byId.bob.exclusion).toBe('activity_floor');
  expect(byId.owner.exclusion).toBe('owner_or_admin');
  expect(byId.twin.exclusion).toBe('shared_payout');

  const summary = await payoutSummary('alice');
  expect(summary.accruedCents).toBe(10_000);
  expect(summary.payable).toBe(true);
  expect((await payoutSummary('bob')).accruedCents).toBe(0);

  // Trades after settlement change nothing: finals are stored.
  await buys('bob', 20, 0.01, ['sept-a'], '-late');
  expect((await settleDuePools(startOfOct)).settled).toEqual([]);
  const again = await computePoolBoard(WS, SEPT);
  expect(again?.entries.find(e => e.agentId === 'bob')?.payoutCents).toBe(0);
  expect((await db.select().from(workspacePoolResults)).length).toBe(4);
  expect((await db.select().from(payouts)).length).toBe(1);
});

test('a month nobody wins rolls its pool into the next month, never back to the owner', async () => {
  await startDuePools(startOfSept);
  await settleDuePools(startOfOct);
  const [next] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, '2026-10')));
  expect(next.status).toBe('scheduled');
  expect(next.rolloverCents).toBe(10_000);
  expect(next.poolCents).toBe(0);
  await addToScheduledPool(db, WS, '2026-10', 500);
  await startDuePools(startOfOct);
  const [oct] = await db
    .select()
    .from(workspacePools)
    .where(and(eq(workspacePools.workspaceId, WS), eq(workspacePools.month, '2026-10')));
  expect((oct.rules as { totalCents: number }).totalCents).toBe(10_500);
});
