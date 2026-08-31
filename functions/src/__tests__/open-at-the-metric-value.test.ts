/**
 * A funded, untraded baseline market opens at its metric's current value,
 * whichever code path funded it.
 *
 * Two bugs, both reported by the owner on 2026-08-31 ("the telarchy revenue
 * markets seem being spawned at 500 instead of 0 even tho latest values are
 * 0 .. make sure the bug isnt anywhere else either"):
 *
 *  1. `nearHorizonAnchorP` returned null for a value AT a range edge, and null
 *     means "keep the midpoint". "Telarchy revenue (USD)", range 0 to 1,000
 *     and reading $0 every hour, therefore opened its daily market at $499.97
 *     (telarchy.com, 2026-08-31T00:10Z) and paid whoever pushed it back down.
 *  2. Only one of the three funding paths anchored at all. A market that
 *     opened unfunded and was funded by a later refresh, and a market created
 *     through POST /api/predictions/markets, both kept the midpoint forever.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { consensus } from '../lib/amm';
import { toAbsoluteDate } from '../lib/date-utils';
import { toUnits } from '../lib/validation';
import { insertPendingMarkets, refreshRelativeDateMarkets } from '../services/markets';
import type { TimePreference } from '../types';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-open-at-value';
const OWNER = 'owner-open-at-value';
const NEAR = toAbsoluteDate('+2w');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(opts: { balance: number; value: number; rangeMax: number; tp?: TimePreference | null }) {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-open', balance: toUnits(opts.balance) });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Telarchy',
    createdBy: OWNER,
    visibility: 'public',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: 100,
  });
  await db.insert(metrics).values({
    id: 'm-revenue',
    workspaceId: WS,
    name: 'Telarchy revenue (USD)',
    value: opts.value,
    formula: '0',
    marketRangeMax: opts.rangeMax,
    timePreference: opts.tp ?? null,
  });
}

const pending = (marketId: string, rangeMax: number, targetDate = NEAR) => [
  { marketId, metricId: 'm-revenue', metricName: 'Telarchy revenue (USD)', targetDate, rangeMax },
];

async function openingValue(marketId: string): Promise<number> {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, WS)));
  return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) as number;
}

test('a metric reading $0 on a 0-1000 range does not open its market at $500', async () => {
  await seed({ balance: 500, value: 0, rangeMax: 1000 });
  await insertPendingMarkets(pending('mk-zero', 1000), WS);

  const opened = await openingValue('mk-zero');
  // 2% of the range: the lowest price an LMSR book can be seeded at without
  // its worst-case loss diverging (anchoredMarketState's clamp). The number
  // that matters is that it is nowhere near 500.
  expect(opened).toBeCloseTo(20, 1);
  expect(opened).toBeLessThan(100);
});

test('a metric reading its range top opens at the top, not the middle', async () => {
  await seed({ balance: 500, value: 50, rangeMax: 50 });
  await insertPendingMarkets(pending('mk-top', 50), WS);
  expect(await openingValue('mk-top')).toBeCloseTo(49, 1);
});

test('an ordinary mid-range value still opens exactly at the value', async () => {
  await seed({ balance: 500, value: 300, rangeMax: 1000 });
  await insertPendingMarkets(pending('mk-mid', 1000), WS);
  expect(await openingValue('mk-mid')).toBeCloseTo(300, 0);
});

test('a far-horizon market keeps the midpoint, because today is not an estimate of next year', async () => {
  await seed({ balance: 500, value: 0, rangeMax: 1000 });
  await insertPendingMarkets(pending('mk-far', 1000, '2099-12-31'), WS);
  expect(await openingValue('mk-far')).toBeCloseTo(500, 0);
});

test('a market funded by a LATER refresh is anchored too, not left at the midpoint', async () => {
  // It opened unfunded because the owner's balance was short that morning.
  await seed({
    balance: 0,
    value: 0,
    rangeMax: 1000,
    tp: { enabled: false, halfLife: 1, customHorizons: ['+2w'] },
  });
  await refreshRelativeDateMarkets(WS, { force: true });
  const [unfunded] = await db.select().from(markets).where(eq(markets.workspaceId, WS));
  expect(unfunded.pool ?? 0).toBe(0);
  expect(unfunded.liquidity).toBe(0);

  // The owner tops up; the next refresh funds it.
  await db
    .update(agents)
    .set({ balance: toUnits(500) })
    .where(eq(agents.id, OWNER));
  await refreshRelativeDateMarkets(WS, { force: true });

  const [funded] = await db.select().from(markets).where(eq(markets.workspaceId, WS));
  expect(funded.pool ?? 0).toBeGreaterThan(0);
  expect(await openingValue(funded.id)).toBeLessThan(100);
});
