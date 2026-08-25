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

import { and, eq, isNull } from 'drizzle-orm';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { sampleTimePoints } from '../lib/time-preference';
import { toUnits } from '../lib/validation';
import { refreshRelativeDateMarkets } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-refresh-cond';
const OWNER = 'owner-agent';
const METRIC = 'metric-cond';

async function seed(timePreference: { enabled: true; halfLife: number; density?: number }) {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Refresh Conditional Test',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) }]);
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Steam recent review percentage',
    value: 94,
    formula: '0',
    marketRangeMax: 100,
    timePreference,
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
        id: 'mkt-mid',
        workspaceId: WS,
        metricId: METRIC,
        metricName: 'Steam recent review percentage',
        targetDate: midDate,
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 1,
        pool: 1,
        active: true,
        resolved: false,
        voided: false,
      },
      {
        id: 'mkt-far',
        workspaceId: WS,
        metricId: METRIC,
        metricName: 'Steam recent review percentage',
        targetDate: farDate,
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 1,
        pool: 1,
        active: true,
        resolved: false,
        voided: false,
      },
      {
        id: 'mkt-cond-near',
        workspaceId: WS,
        metricId: METRIC,
        metricName: 'Steam recent review percentage',
        proposalId: 'stale-proposal-1',
        branch: 'approved',
        targetDate: nearDate,
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 1,
        pool: 1,
        active: true,
        resolved: false,
        voided: false,
      },
    ]);

    await refreshRelativeDateMarkets(WS, { force: true });

    const baselineNear = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, WS),
          eq(markets.metricId, METRIC),
          eq(markets.targetDate, nearDate),
          eq(markets.resolved, false),
        ),
      );
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

    const created = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, METRIC)));
    expect(created.length).toBe(3);
    expect(created.every(m => m.proposalId === null)).toBe(true);
    expect(created.every(m => m.active === true)).toBe(true);
  });

  // Regression for the "conditional markets list permanently empty" bug: a
  // pending proposal whose conditional markets were all voided (e.g. by a
  // relative-date rollover) still references the dead rows in
  // conditionalMarketIds, so the lazy re-spawn keyed on an empty id list never
  // fires. refreshRelativeDateMarkets must re-align it against the live baselines.
  test('re-spawns conditional markets for a pending proposal that has none left', async () => {
    const tp = { enabled: true as const, halfLife: 1, density: 3 };
    await seed(tp);

    // Live baselines for the metric.
    await refreshRelativeDateMarkets(WS, { force: true });
    const baselines = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), isNull(markets.proposalId)));
    expect(baselines.length).toBe(3);

    // A pending proposal that thinks it has conditional markets, but every one
    // it references has been voided (resolved=true), so zero are live.
    await db.insert(proposals).values({
      id: 'prop-dead',
      workspaceId: WS,
      proposedBy: OWNER,
      title: 'Pending proposal with dead conditionals',
      description: '',
      status: 'pending',
      conditionalMarketIds: ['dead-1', 'dead-2'],
      liquiditySubsidy: 0,
      subsidyContributions: {},
    });
    await db.insert(markets).values([
      {
        id: 'dead-1',
        workspaceId: WS,
        metricId: METRIC,
        metricName: 'Steam recent review percentage',
        proposalId: 'prop-dead',
        branch: 'approved',
        targetDate: baselines[0].targetDate,
        rangeMin: 0,
        rangeMax: 100,
        shares: [0, 0],
        liquidity: 0,
        pool: 0,
        active: false,
        resolved: true,
        voided: true,
      },
    ]);

    const before = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, 'prop-dead'), eq(markets.resolved, false)));
    expect(before.length).toBe(0);

    const result = await refreshRelativeDateMarkets(WS, { force: true });
    expect(result.conditionalRespawned).toBe(1);

    const live = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, 'prop-dead'), eq(markets.resolved, false)));
    // Two branches (approved + declined) per live baseline date.
    expect(live.length).toBe(baselines.length * 2);

    const [updated] = await db.select().from(proposals).where(eq(proposals.id, 'prop-dead'));
    expect((updated.conditionalMarketIds as string[]).length).toBe(live.length);
    expect(updated.conditionalMarketIds as string[]).not.toContain('dead-1');
  });

  // Approved/declined proposals void a branch on purpose; the refresh must not
  // resurrect their dead counterfactual branch.
  test('does not re-spawn conditional markets for a non-pending proposal', async () => {
    const tp = { enabled: true as const, halfLife: 1, density: 3 };
    await seed(tp);
    await refreshRelativeDateMarkets(WS, { force: true });

    await db.insert(proposals).values({
      id: 'prop-approved',
      workspaceId: WS,
      proposedBy: OWNER,
      title: 'Approved proposal',
      description: '',
      status: 'approved',
      conditionalMarketIds: ['gone-1'],
      liquiditySubsidy: 0,
      subsidyContributions: {},
    });

    const result = await refreshRelativeDateMarkets(WS, { force: true });
    expect(result.conditionalRespawned).toBe(0);

    const live = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, 'prop-approved'), eq(markets.resolved, false)));
    expect(live.length).toBe(0);
  });
});
