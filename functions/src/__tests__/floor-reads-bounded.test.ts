/**
 * The floor payload (GET /api/marketplace/:idOrSlug) is rebuilt on every poll
 * of every open floor, 12,600 times on 2026-09-13, so what it reads per build
 * is paid thousands of times a day (docs/infra/deploy.md, "Reads are bounded
 * in the size of a workspace").
 *
 * Two reads grew with the floor's history instead of with what it shows:
 * the trader count grouped every trade the workspace ever took (2,000 rows a
 * build, 26M rows that day), and the hero metric's log was read twice, once
 * for heroHistory and again for its horizon. The answers must not change.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metricLogs, metrics, permissionGroups, proposals, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { marketplaceRouter } from '../routes/marketplace';
import { captureQueries, rowsRead } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-floor-reads';
const OWNER = 'agent-fr-owner';
const OLD_BOOKS = 400;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

const book = (over: Partial<typeof markets.$inferInsert>): typeof markets.$inferInsert => ({
  id: 'x',
  workspaceId: WS,
  metricId: 'metric-a',
  metricName: 'Net (USD)',
  targetDate: '2026-12',
  rangeMin: 0,
  rangeMax: 1_000,
  shares: [0, 0] as [number, number],
  liquidity: 100,
  pool: initialPool(100),
  active: true,
  resolved: false,
  voided: false,
  proposalId: null,
  branch: null,
  ...over,
});

const trade = (id: string, agentId: string, marketId: string): typeof trades.$inferInsert => ({
  id,
  workspaceId: WS,
  agentId,
  marketId,
  direction: 'higher',
  shares: 1,
  cost: 1,
  createdAt: new Date('2026-08-01T10:00:00Z'),
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-fr-o', balance: 0 },
    { id: 't1', apiKeyHash: 'h-fr-1', balance: 0 },
    { id: 't2', apiKeyHash: 'h-fr-2', balance: 0 },
    { id: 't3', apiKeyHash: 'h-fr-3', balance: 0 },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Floor Reads',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));

  await db.insert(metrics).values([
    { id: 'metric-a', workspaceId: WS, name: 'Net (USD)', value: 10, formula: '0', marketRangeMax: 1_000 },
    { id: 'metric-b', workspaceId: WS, name: 'Users', value: 3, formula: '0', marketRangeMax: 100 },
  ]);
  await db
    .insert(markets)
    .values([
      book({ id: 'mk-a' }),
      book({ id: 'mk-b', metricId: 'metric-b', metricName: 'Users', targetDate: '2026-11', rangeMax: 100 }),
      book({ id: 'br-a-app', proposalId: 'prop-1', branch: 'approved' }),
      book({ id: 'br-a-dec', proposalId: 'prop-1', branch: 'declined' }),
    ]);
  await db.insert(proposals).values({
    id: 'prop-1',
    workspaceId: WS,
    number: 1,
    proposedBy: 't1',
    title: 'Ship it',
    description: 'Ship the thing.',
    askUsd: 10,
    status: 'pending',
  });
  // The floor's history: settled books nobody shows any more, each traded.
  const old = Array.from({ length: OLD_BOOKS }, (_, i) =>
    book({ id: `old-${i}`, targetDate: '2025-01', active: false, resolved: true, actualValue: 1 }),
  );
  for (let i = 0; i < old.length; i += 200) await db.insert(markets).values(old.slice(i, i + 200));
  const oldTrades = old.flatMap((m, i) => [trade(`ot-${i}-1`, 't1', m.id!), trade(`ot-${i}-2`, 't2', m.id!)]);
  for (let i = 0; i < oldTrades.length; i += 400) await db.insert(trades).values(oldTrades.slice(i, i + 400));
  // What the floor shows: two traders on mk-a (one of them twice), one on
  // the approved branch, nobody on mk-b or the declined branch.
  await db
    .insert(trades)
    .values([
      trade('tr-a-1', 't1', 'mk-a'),
      trade('tr-a-2', 't1', 'mk-a'),
      trade('tr-a-3', 't2', 'mk-a'),
      trade('tr-br-1', 't3', 'br-a-app'),
    ]);
  const reading = (id: string, metricId: string, metricName: string, value: number, at: string) => ({
    id,
    workspaceId: WS,
    metricId,
    metricName,
    value,
    timestamp: new Date(at),
  });
  await db
    .insert(metricLogs)
    .values([
      reading('log-a1', 'metric-a', 'Net (USD)', 1, '2026-08-01T09:00:00Z'),
      reading('log-a2', 'metric-a', 'Net (USD)', 5, '2026-08-02T09:00:00Z'),
      reading('log-a3', 'metric-a', 'Net (USD)', 10, '2026-08-03T09:00:00Z'),
      reading('log-b1', 'metric-b', 'Users', 3, '2026-08-03T09:00:00Z'),
    ]);
});

async function floorWithLog() {
  const log = captureQueries();
  let body: any;
  try {
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    body = res.body;
  } finally {
    log.stop();
  }
  return { body, stats: log.stats };
}

describe('THE FLOOR COUNTS TRADERS ONLY ON THE BOOKS IT SHOWS', () => {
  test('each shown book and branch still reports its distinct traders', async () => {
    const { body } = await floorWithLog();
    const byId = new Map((body.markets as Array<{ marketId: string; traderCount: number }>).map(m => [m.marketId, m]));
    expect(byId.get('mk-a')?.traderCount).toBe(2);
    expect(byId.get('mk-b')?.traderCount).toBe(0);
    const pair = (body.proposals as Array<{ id: string; markets: Array<Record<string, unknown>> }>).find(
      p => p.id === 'prop-1',
    )!.markets[0];
    expect(pair.approvedTraders).toBe(1);
    expect(pair.declinedTraders).toBe(0);
  });

  test("the count reads the shown books' trades, not the floor's history", async () => {
    const { stats } = await floorWithLog();
    const counts = stats.filter(
      s => /count\(distinct "(trades"\.")?agent_id"\)/.test(s.sql) && s.sql.includes('"market_id"'),
    );
    expect(counts.length).toBeGreaterThan(0);
    let read = 0;
    for (const s of counts) read += await rowsRead(s, 'trades');
    // Four trades sit on shown books; the 800 on settled books are history.
    expect(read).toBeLessThanOrEqual(4);
  });
});

describe("THE FLOOR READS EACH METRIC'S LOG ONCE PER BUILD", () => {
  test('one metric_logs read per metric with an open book', async () => {
    const { stats } = await floorWithLog();
    expect(stats.filter(s => s.sql.includes('from "metric_logs"'))).toHaveLength(2);
  });

  test("heroHistory is still the hero metric's whole log, oldest first, as its horizon draws it", async () => {
    const { body } = await floorWithLog();
    expect(body.heroHistory.map((p: { value: number }) => p.value)).toEqual([1, 5, 10]);
    const horizon = body.horizonHistories.find((h: { marketId: string }) => h.marketId === 'mk-a');
    expect(body.heroHistory).toEqual(horizon.points);
  });
});
