/**
 * The season's settled half starts from traded books (docs/infra/deploy.md,
 * "The season's settled half starts from traded books").
 *
 * A void sets `resolved`, so the books settled inside a season window are
 * mostly untraded voids on a floor that opens and voids thousands a day: the
 * chess floor voids every option but one, every move. The read used the
 * `resolved_at` index over all of them and then threw them away one by one.
 * It now names `traded_volume > 0`, which every book with a trade has, so the
 * partial index `markets (resolved_at) where resolved and traded_volume > 0`
 * serves it. The score is pinned unchanged, voids with trades included.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadSeasonSettled } from '../lib/board';
import { captureQueries } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-season-traded';
const WINDOW_START = new Date('2026-09-01T00:00:00Z');
const WINDOW_END = new Date('2026-10-01T00:00:00Z');
const SETTLED_AT = new Date('2026-09-10T00:00:00Z');

function book(id: string, over: Partial<typeof markets.$inferInsert>) {
  return {
    id,
    workspaceId: WS,
    metricId: 'metric',
    metricName: 'Game score',
    targetDate: '2026-09-10',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    ...over,
  };
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'kai', apiKeyHash: 'h-kai', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'Season', createdBy: 'kai', visibility: 'public' });
  await db
    .insert(markets)
    .values([
      book('won', { resolved: true, active: false, actualValue: 80, resolvedAt: SETTLED_AT, tradedVolume: 4 }),
      book('voided-traded', { resolved: true, voided: true, active: false, resolvedAt: SETTLED_AT, tradedVolume: 4 }),
    ]);
  await db.insert(trades).values([
    {
      id: 't-won',
      workspaceId: WS,
      agentId: 'kai',
      marketId: 'won',
      direction: 'higher',
      shares: 10,
      cost: 4,
      kind: 'trade',
    },
    {
      id: 't-void',
      workspaceId: WS,
      agentId: 'kai',
      marketId: 'voided-traded',
      direction: 'higher',
      shares: 10,
      cost: 4,
      kind: 'trade',
    },
  ]);
  await db.insert(positions).values([
    {
      id: 'kai_won_higher',
      workspaceId: WS,
      agentId: 'kai',
      marketId: 'won',
      direction: 'higher',
      shares: 10,
      totalCost: 4,
    },
    {
      id: 'kai_voided-traded_higher',
      workspaceId: WS,
      agentId: 'kai',
      marketId: 'voided-traded',
      direction: 'higher',
      shares: 10,
      totalCost: 4,
    },
  ]);
});

async function untradedVoids(n: number) {
  const rows = Array.from({ length: n }, (_, i) =>
    book(`void-${i}`, { resolved: true, voided: true, active: false, resolvedAt: SETTLED_AT }),
  );
  for (let i = 0; i < rows.length; i += 500) await db.insert(markets).values(rows.slice(i, i + 500));
}

test('the score is the same with and without 2,000 untraded voids in the window, the traded void included', async () => {
  const before = await loadSeasonSettled([WS], WINDOW_START, WINDOW_END);
  expect(before.get('kai')).toBeDefined();
  await untradedVoids(2000);
  const after = await loadSeasonSettled([WS], WINDOW_START, WINDOW_END);
  expect([...after]).toEqual([...before]);
}, 60_000);

test("the settled read's market predicate names traded_volume, so the traded-books index can serve it", async () => {
  const log = captureQueries();
  try {
    await loadSeasonSettled([WS], WINDOW_START, WINDOW_END);
  } finally {
    log.stop();
  }
  const settledRead = log.stats.find(s => /from "markets"/i.test(s.sql) && /"resolved_at"/i.test(s.sql));
  expect(settledRead).toBeDefined();
  expect(settledRead!.sql).toMatch(/"traded_volume" > /i);
});
