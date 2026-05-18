/**
 * Regression test for the "conditional market blocks baseline market creation"
 * bug: refreshRelativeDateMarkets was adding every open market (including those
 * scoped to a proposal) into the `openKeys` set used to decide which baseline
 * markets to create. A stale conditional market at one of the metric's current
 * sample dates would silently prevent the baseline market at that date from
 * being (re)spawned by the daily refresh, leaving the metric's time series with
 * a permanent gap.
 *
 * Observed in production on LookPilot's "Steam recent review percentage" metric
 * (halfLife=1, density=3) where the daily refresh kept creating 2027-05 and
 * 2028-12 but never 2026-08, because a year-old conditional market at 2026-08
 * was occupying the key.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq, and } from 'drizzle-orm';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { workspaces, agents, metrics, markets, systemConfig } from '../db/schema';
import { toUnits } from '../lib/validation';
import { refreshRelativeDateMarkets } from '../services/markets';
import { sampleTimePoints } from '../lib/time-preference';

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-refresh-cond';
const OWNER = 'owner-agent';
const METRIC = 'metric-cond';

async function seed(timePreference: { enabled: true; halfLife: number; density?: number }) {
  await db.insert(workspaces).values({
    id: WS, name: 'Refresh Conditional Test', createdBy: OWNER, visibility: 'private',
  });
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) },
  ]);
  await db.insert(metrics).values({
    id: METRIC, workspaceId: WS, name: 'Steam recent review percentage', value: 94,
    formula: '0', marketRangeMax: 100, timePreference,
  });
}

describe('refreshRelativeDateMarkets and conditional markets', () => {
  test('creates a baseline market at a sample date even when a conditional market already occupies it', async () => {
    const tp = { enabled: true as const, halfLife: 1, density: 3 };
    await seed(tp);

    const sampleDates = sampleTimePoints(tp.halfLife, tp.density).map(p => p.date);
    expect(sampleDates).toHaveLength(3);
    const [nearDate, midDate, farDate] = sampleDates;

    // Pre-seed: only mid and far baselines exist. A stale conditional market
    // (proposalId set) occupies the near date.
    await db.insert(markets).values([
      {
        id: 'mkt-mid', workspaceId: WS, metricId: METRIC, metricName: 'Steam recent review percentage',
        targetDate: midDate, rangeMin: 0, rangeMax: 100,
        shares: [0, 0], liquidity: 1, pool: 1,
        active: true, resolved: false, voided: false,
      },
      {
        id: 'mkt-far', workspaceId: WS, metricId: METRIC, metricName: 'Steam recent review percentage',
        targetDate: farDate, rangeMin: 0, rangeMax: 100,
        shares: [0, 0], liquidity: 1, pool: 1,
        active: true, resolved: false, voided: false,
      },
      {
        id: 'mkt-cond-near', workspaceId: WS, metricId: METRIC, metricName: 'Steam recent review percentage',
        proposalId: 'stale-proposal-1', targetDate: nearDate, rangeMin: 0, rangeMax: 100,
        shares: [0, 0], liquidity: 1, pool: 1,
        active: true, resolved: false, voided: false,
      },
    ]);

    await refreshRelativeDateMarkets(WS, { force: true });

    const baselineNear = await db.select().from(markets).where(and(
      eq(markets.workspaceId, WS),
      eq(markets.metricId, METRIC),
      eq(markets.targetDate, nearDate),
      eq(markets.resolved, false),
    ));
    const baselineRow = baselineNear.find(m => m.proposalId === null);
    expect(baselineRow).toBeDefined();
    expect(baselineRow!.active).toBe(true);

    // The conditional market is untouched.
    const cond = baselineNear.find(m => m.proposalId === 'stale-proposal-1');
    expect(cond).toBeDefined();
    expect(cond!.active).toBe(true);
  });

  test('still creates the baseline when no conditional market is in the way', async () => {
    const tp = { enabled: true as const, halfLife: 1, density: 3 };
    await seed(tp);

    await refreshRelativeDateMarkets(WS, { force: true });

    const created = await db.select().from(markets).where(and(
      eq(markets.workspaceId, WS),
      eq(markets.metricId, METRIC),
    ));
    expect(created.length).toBe(3);
    expect(created.every(m => m.proposalId === null)).toBe(true);
    expect(created.every(m => m.active === true)).toBe(true);
  });
});
