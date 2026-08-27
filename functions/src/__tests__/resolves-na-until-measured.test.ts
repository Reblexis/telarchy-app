/**
 * A market on a number that does not exist yet resolves N/A (owner ask
 * 2026-08-25: "if invested in what is the implied valuation.. if not
 * invested.. it resolves N/A"). docs/ui-conventions.md, same title.
 */
jest.mock('../db/client', () => require('./harness/test-db'));
// notifyMarketResolved reads the market's traders and pushes to them; under the
// single-connection test database that runs alongside the test's next query
// and deadlocks it. The notification is not what this file tests.
jest.mock('../services/notifications', () => ({
  notifyMarketResolved: async () => undefined,
  notifyCommentPosted: async () => undefined,
}));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant } from '../lib/date-utils';
import { toUnits } from '../lib/validation';
import { resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-na';
const OWNER = 'owner-na';
const TRADER = 'trader-na';
const METRIC = 'metric-valuation';
const MARKET = 'market-valuation';
const TARGET = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 13); // an hour that has ended
const BOUNDARY = periodEndInstant(TARGET);

async function seed(opts: { flagged: boolean; reading?: number }) {
  await db.insert(workspaces).values({ id: WS, name: 'NA Test', createdBy: OWNER, visibility: 'private' });
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner-na', balance: toUnits(0) });
  await db.insert(agents).values({ id: TRADER, apiKeyHash: 'h-trader-na', balance: toUnits(0) });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Implied valuation (USD)',
    value: 0, // the default of a never-measured metric
    formula: '0',
    marketRangeMax: 20_000_000,
    resolvesNaUntilMeasured: opts.flagged,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Implied valuation (USD)',
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 20_000_000,
    shares: [0, 10],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
  // A trader holding HIGHER shares, who would be paid nothing by a "$0" settlement.
  await db.insert(positions).values({
    id: 'pos-na',
    workspaceId: WS,
    marketId: MARKET,
    agentId: TRADER,
    shares: 10,
    direction: 'higher',
    totalCost: toUnits(40),
  });
  // The buy that opened it: a void refunds each trader's net cash from trades.
  await db.insert(trades).values({
    id: 'trade-na',
    workspaceId: WS,
    marketId: MARKET,
    agentId: TRADER,
    direction: 'higher',
    shares: 10,
    cost: 40,
  });
  if (opts.reading !== undefined) {
    await db.insert(metricLogs).values({
      id: 'log-na',
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Implied valuation (USD)',
      value: opts.reading,
      outlook: opts.reading,
      timestamp: new Date(BOUNDARY.getTime() - 60_000),
    });
  }
}

async function market() {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, MARKET), eq(markets.workspaceId, WS)));
  return m;
}

test('a flagged metric with no reading voids the market instead of settling on 0', async () => {
  await seed({ flagged: true });
  const out = await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(true);
  expect(m.resolved).toBe(true);
  expect(m.actualValue).toBeNull();
  expect(out.resolved).toBe(0);
  // The trader got their money back rather than a "$0 valuation" loss.
  const [trader] = await db.select().from(agents).where(eq(agents.id, TRADER));
  expect(Number(trader.balance)).toBeGreaterThan(0);
});

test('the first reading ends the state: a flagged metric with a reading settles on it', async () => {
  await seed({ flagged: true, reading: 12_000_000 });
  await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(false);
  expect(m.resolved).toBe(true);
  expect(m.actualValue).toBe(12_000_000);
});

test('without the flag nothing changes: no reading falls back to the live value', async () => {
  await seed({ flagged: false });
  await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(false);
  expect(m.resolved).toBe(true);
  expect(m.actualValue).toBe(0);
});

// ── The general case (owner direction 2026-08-27): any update may supply N/A ──

const naLog = (id: string, secondsBeforeBoundary: number, value: number | null) =>
  db.insert(metricLogs).values({
    id,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Implied valuation (USD)',
    value,
    outlook: value,
    timestamp: new Date(BOUNDARY.getTime() - secondsBeforeBoundary * 1000),
  });

test('an explicit N/A reading at the boundary voids, even after earlier numbers', async () => {
  await seed({ flagged: false, reading: 12_000_000 });
  await naLog('log-na-explicit', 30, null);
  const out = await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(true);
  expect(m.actualValue).toBeNull();
  expect(out.resolved).toBe(0);
  const [trader] = await db.select().from(agents).where(eq(agents.id, TRADER));
  expect(Number(trader.balance)).toBeGreaterThan(0);
});

test('a number after an N/A reading settles the market on the number', async () => {
  await seed({ flagged: false });
  await naLog('log-na-first', 120, null);
  await naLog('log-num-after', 30, 12_000_000);
  await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(false);
  expect(m.resolved).toBe(true);
  expect(m.actualValue).toBe(12_000_000);
});

test('with no log at all, a live reading of N/A voids instead of falling back to a number', async () => {
  await seed({ flagged: false });
  await db
    .update(metrics)
    .set({ value: null })
    .where(and(eq(metrics.id, METRIC), eq(metrics.workspaceId, WS)));
  await resolvePredictions(undefined, WS);
  const m = await market();
  expect(m.voided).toBe(true);
  expect(m.actualValue).toBeNull();
});
