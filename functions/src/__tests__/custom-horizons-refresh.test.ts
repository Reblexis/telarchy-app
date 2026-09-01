/**
 * Integration tests for custom horizons in the daily market refresh:
 *  - a custom-only metric (curve off) gets markets for its horizons
 *  - removing a horizon voids its market when nobody has traded it, and
 *    leaves it open when somebody has
 *  - disabling the curve keeps custom-horizon markets alive
 *  - manual one-off markets on unmanaged metrics survive the refresh
 *    (both the deactivation and the rangeMax-mismatch-void paths)
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, trades, workspaces } from '../db/schema';
import { periodStartInstant, toAbsoluteDate } from '../lib/date-utils';
import { desiredMarketDates } from '../lib/time-preference';
import { toUnits } from '../lib/validation';
import { refreshRelativeDateMarkets } from '../services/markets';
import { resolvePredictions } from '../services/predictions';
import type { TimePreference } from '../types';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-custom-horizons';

async function seedWorkspace() {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Custom Horizons Test',
    createdBy: 'owner',
    visibility: 'private',
  });
}

async function seedMetric(id: string, name: string, tp: TimePreference | null, rangeMax = 100) {
  await db.insert(metrics).values({
    id,
    workspaceId: WS,
    name,
    value: 0,
    formula: '0',
    marketRangeMax: rangeMax,
    timePreference: tp,
  });
}

async function marketsFor(metricId: string) {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.metricId, metricId)));
}

describe('refreshRelativeDateMarkets with custom horizons', () => {
  test('custom-only metric (curve off) gets markets at its horizons', async () => {
    await seedWorkspace();
    const tp: TimePreference = { enabled: false, halfLife: 1, customHorizons: ['+2w', '2099-12-31'] };
    await seedMetric('m1', 'Custom Only', tp);

    const { created } = await refreshRelativeDateMarkets(WS, { force: true });
    expect(created).toBe(2);

    const rows = await marketsFor('m1');
    const dates = rows.map(r => r.targetDate).sort();
    expect(dates).toEqual([toAbsoluteDate('+2w'), '2099-12-31'].sort());
    expect(rows.every(r => r.active)).toBe(true);
  });

  // Owner decision 2026-08-31 (docs/market-integrity.md, "Stopping a date is
  // not destroying a market"): what stopping does depends on whether anyone is
  // in the market. Nobody is here, so it goes and its pool comes back.
  test('removing a horizon voids its untraded market; the rest stay active', async () => {
    await seedWorkspace();
    const rollingDate = toAbsoluteDate('+2w');
    await seedMetric('m1', 'Custom Only', { enabled: false, halfLife: 1, customHorizons: ['+2w', '2099-12-31'] });
    await refreshRelativeDateMarkets(WS, { force: true });

    await db
      .update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] } })
      .where(eq(metrics.id, 'm1'));
    await refreshRelativeDateMarkets(WS, { force: true });

    const rows = await marketsFor('m1');
    const byDate = new Map(rows.map(r => [r.targetDate, r]));
    const dropped = byDate.get(rollingDate)!;
    expect(dropped.active).toBe(false);
    // Voided rather than deactivated, which is what sends the pool back to
    // whoever funded it instead of leaving it in a book nobody will read.
    expect(dropped.voided).toBe(true);
    expect(dropped.resolved).toBe(true);
    expect(byDate.get('2099-12-31')!.active).toBe(true);
  });

  // The other half of the same decision: a market people are in is left
  // exactly as it is, so nobody is locked out of a position they took.
  test('removing a horizon leaves a TRADED market open, and only stops the next one', async () => {
    await seedWorkspace();
    const rollingDate = toAbsoluteDate('+2w');
    await seedMetric('m1', 'Custom Only', { enabled: false, halfLife: 1, customHorizons: ['+2w', '2099-12-31'] });
    await refreshRelativeDateMarkets(WS, { force: true });

    const [traded] = (await marketsFor('m1')).filter(r => r.targetDate === rollingDate);
    await db.insert(agents).values({ id: 'trader-1', apiKeyHash: 'h-trader-1', balance: toUnits(500) });
    await db.insert(trades).values({
      id: 'trade-1',
      workspaceId: WS,
      agentId: 'trader-1',
      marketId: traded.id,
      direction: 'higher',
      shares: 12,
      cost: 25,
    });
    await db.update(markets).set({ tradedVolume: 25 }).where(eq(markets.id, traded.id));

    await db
      .update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] } })
      .where(eq(metrics.id, 'm1'));
    await refreshRelativeDateMarkets(WS, { force: true });

    const [after] = (await marketsFor('m1')).filter(r => r.id === traded.id);
    expect(after.active).toBe(true);
    expect(after.voided).toBe(false);
    expect(after.resolved).toBe(false);
  });

  test('disabling the curve keeps custom-horizon markets, deactivates curve markets', async () => {
    await seedWorkspace();
    const curveTP: TimePreference = { enabled: true, halfLife: 1, density: 3, customHorizons: ['2099-12-31'] };
    await seedMetric('m1', 'Curve Plus Custom', curveTP);
    await refreshRelativeDateMarkets(WS, { force: true });

    const curveDates = desiredMarketDates({ enabled: true, halfLife: 1, density: 3 });
    let rows = await marketsFor('m1');
    expect(rows).toHaveLength(curveDates.length + 1);

    await db
      .update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] } })
      .where(eq(metrics.id, 'm1'));
    await refreshRelativeDateMarkets(WS, { force: true });

    rows = await marketsFor('m1');
    for (const r of rows) {
      expect(r.active).toBe(r.targetDate === '2099-12-31');
    }
  });

  test('manual market on an unmanaged metric survives refresh (deactivation + rangeMax-void paths)', async () => {
    await seedWorkspace();
    await seedMetric('m-manual', 'No TP Metric', null, 100);
    // Manual one-off market with a custom range that mismatches marketRangeMax.
    await db.insert(markets).values({
      id: 'manual-1',
      workspaceId: WS,
      metricId: 'm-manual',
      metricName: 'No TP Metric',
      targetDate: '2099-06',
      rangeMin: 0,
      rangeMax: 50,
      shares: [0, 0],
      liquidity: 10,
      pool: 10,
      active: true,
      resolved: false,
      voided: false,
    });
    // A managed metric in the same workspace so the refresh has real work to do.
    await seedMetric('m-managed', 'Managed Metric', { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] });

    await refreshRelativeDateMarkets(WS, { force: true });

    const [manual] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.id, 'manual-1')));
    expect(manual.active).toBe(true);
    expect(manual.resolved).toBe(false);
    expect(manual.voided).toBe(false);
    expect(manual.rangeMax).toBe(50); // not voided/recreated despite the mismatch
  });

  test('hour horizons: +1h creates an hour market; a passed hour market resolves', async () => {
    await seedWorkspace();
    await seedMetric('m-hour', 'Hourly Metric', { enabled: false, halfLife: 1, customHorizons: ['+1h'] });

    await refreshRelativeDateMarkets(WS, { force: true });
    const rows = await marketsFor('m-hour');
    expect(rows).toHaveLength(1);
    expect(rows[0].targetDate).toBe(toAbsoluteDate('+1h'));
    expect(rows[0].targetDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);

    // A market whose hour has fully passed resolves on the next (hourly) run.
    const past = new Date();
    past.setUTCHours(past.getUTCHours() - 2);
    const pastHour = past.toISOString().slice(0, 13);
    await db.insert(markets).values({
      id: 'hour-past',
      workspaceId: WS,
      metricId: 'm-hour',
      metricName: 'Hourly Metric',
      targetDate: pastHour,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: 10,
      active: true,
      resolved: false,
      voided: false,
    });
    // A market resolves on a reading dated inside its own hour, not because
    // the hour passed (docs/market-integrity.md, "A market resolves on its
    // reading, not on a clock"). Without this the market stays open, which is
    // the point: nobody has that hour's number yet.
    await db.insert(metricLogs).values({
      id: 'log-hour-past',
      workspaceId: WS,
      metricId: 'm-hour',
      metricName: 'Hourly Metric',
      value: 42,
      timestamp: new Date(periodStartInstant(pastHour).getTime() + 60_000),
    });
    await resolvePredictions(undefined, WS);

    const [resolvedRow] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.id, 'hour-past')));
    expect(resolvedRow.resolved).toBe(true);
    // The +1h market's hour has not passed; it stays open.
    const [openRow] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.id, rows[0].id)));
    expect(openRow.resolved).toBe(false);
  });

  test('managed metric with stale rangeMax still gets voided and recreated', async () => {
    await seedWorkspace();
    await seedMetric('m1', 'Managed', { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] }, 100);
    await db.insert(markets).values({
      id: 'stale-range',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Managed',
      targetDate: '2099-12-31',
      rangeMin: 0,
      rangeMax: 50, // stale vs marketRangeMax=100
      shares: [0, 0],
      liquidity: 10,
      pool: 0,
      active: true,
      resolved: false,
      voided: false,
    });

    await refreshRelativeDateMarkets(WS, { force: true });

    const rows = await marketsFor('m1');
    const stale = rows.find(r => r.id === 'stale-range')!;
    expect(stale.voided).toBe(true);
    const recreated = rows.find(r => r.id !== 'stale-range' && r.targetDate === '2099-12-31')!;
    expect(recreated).toBeDefined();
    expect(recreated.rangeMax).toBe(100);
    expect(recreated.active).toBe(true);
  });
});
