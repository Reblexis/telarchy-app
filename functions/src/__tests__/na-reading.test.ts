jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, positions, trades, workspaces } from '../db/schema';
import { toUnits } from '../lib/validation';
import { getAllMetrics, logSpecificMetrics, metricReadingAsOf } from '../services/metrics';
import { resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

/**
 * A reading that says the number does not exist for its moment (owner ask
 * 2026-09-01: "it should be possible to update value as n/a (unknown) ... it
 * just means the corresponding markets resolve n/a").
 *
 * The distinction that matters: N/A is not zero. An implied valuation with no
 * round closed is not a company worth nothing, and settling a market on that
 * zero would pay out the people who bet low on a fact nobody established.
 */

const WS = 'ws-na-reading';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values({ id: WS, name: 'N/A', createdBy: 'owner', visibility: 'private' });
  await db.insert(agents).values({ id: 'trader-1', apiKeyHash: 'h-1', balance: toUnits(500) });
  await db.insert(metrics).values({
    id: 'm1',
    workspaceId: WS,
    name: 'Implied valuation',
    value: 0,
    formula: '0',
    marketRangeMax: 1000000,
  });
});

test('an N/A reading is stored as such, and is not a zero', async () => {
  const all = await getAllMetrics(WS);
  await logSpecificMetrics(['m1'], all, WS, new Date('2026-09-30T12:00:00Z'), true);
  const [row] = await db.select().from(metricLogs).where(eq(metricLogs.metricId, 'm1'));
  expect(row.na).toBe(true);

  const fixing = await metricReadingAsOf('m1', new Date('2026-10-01T00:00:00Z'), WS);
  expect(fixing?.na).toBe(true);
});

test('the market whose fixing lands on it voids, and every position is refunded', async () => {
  await db.insert(markets).values({
    id: 'mk1',
    workspaceId: WS,
    metricId: 'm1',
    metricName: 'Implied valuation',
    targetDate: '2026-09',
    rangeMin: 0,
    rangeMax: 1000000,
    shares: [0, 0],
    liquidity: 200,
    pool: 138.6,
    active: true,
    resolved: false,
    voided: false,
  });
  await db.insert(trades).values({
    id: 't1',
    workspaceId: WS,
    agentId: 'trader-1',
    marketId: 'mk1',
    direction: 'lower',
    shares: 30,
    cost: 25,
  });
  await db.insert(positions).values({
    id: 'p1',
    workspaceId: WS,
    agentId: 'trader-1',
    marketId: 'mk1',
    direction: 'lower',
    shares: 30,
    totalCost: 25,
  });

  const all = await getAllMetrics(WS);
  await logSpecificMetrics(['m1'], all, WS, new Date('2026-09-30T12:00:00Z'), true);
  await resolvePredictions('2026-10-02', WS);

  const [settled] = await db.select().from(markets).where(eq(markets.id, 'mk1'));
  expect(settled.resolved).toBe(true);
  expect(settled.voided).toBe(true);
  expect(settled.actualValue).toBeNull();

  // The 25 credits they had at stake come back; nobody is paid for being
  // right about a number that was never established.
  const [trader] = await db.select().from(agents).where(eq(agents.id, 'trader-1'));
  expect(Number(trader.balance)).toBe(toUnits(525));
});

test('a later real reading ends the N/A, because it is per moment and not a mode', async () => {
  const all = await getAllMetrics(WS);
  await logSpecificMetrics(['m1'], all, WS, new Date('2026-09-15T12:00:00Z'), true);
  await db.update(metrics).set({ value: 250000 }).where(eq(metrics.id, 'm1'));
  const after = await getAllMetrics(WS);
  await logSpecificMetrics(['m1'], after, WS, new Date('2026-09-28T12:00:00Z'));

  const fixing = await metricReadingAsOf('m1', new Date('2026-10-01T00:00:00Z'), WS);
  expect(fixing?.na).toBe(false);
  expect(fixing?.value).toBe(250000);
});
