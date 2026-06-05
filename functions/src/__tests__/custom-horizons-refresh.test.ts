/**
 * Integration tests for custom horizons in the daily market refresh:
 *  - a custom-only metric (curve off) gets markets for its horizons
 *  - removing a horizon deactivates its market on the next refresh
 *  - disabling the curve keeps custom-horizon markets alive
 *  - manual one-off markets on unmanaged metrics survive the refresh
 *    (both the deactivation and the rangeMax-mismatch-void paths)
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq, and } from 'drizzle-orm';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { workspaces, metrics, markets } from '../db/schema';
import { refreshRelativeDateMarkets } from '../services/markets';
import { desiredMarketDates } from '../lib/time-preference';
import { toAbsoluteDate } from '../lib/date-utils';
import type { TimePreference } from '../types';

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-custom-horizons';

async function seedWorkspace() {
  await db.insert(workspaces).values({
    id: WS, name: 'Custom Horizons Test', createdBy: 'owner', visibility: 'private',
  });
}

async function seedMetric(id: string, name: string, tp: TimePreference | null, rangeMax = 100) {
  await db.insert(metrics).values({
    id, workspaceId: WS, name, value: 0, formula: '0',
    marketRangeMax: rangeMax, timePreference: tp,
  });
}

async function marketsFor(metricId: string) {
  return db.select().from(markets)
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

  test('removing a horizon deactivates its market; the rest stay active', async () => {
    await seedWorkspace();
    const rollingDate = toAbsoluteDate('+2w');
    await seedMetric('m1', 'Custom Only', { enabled: false, halfLife: 1, customHorizons: ['+2w', '2099-12-31'] });
    await refreshRelativeDateMarkets(WS, { force: true });

    await db.update(metrics)
      .set({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] } })
      .where(eq(metrics.id, 'm1'));
    await refreshRelativeDateMarkets(WS, { force: true });

    const rows = await marketsFor('m1');
    const byDate = new Map(rows.map(r => [r.targetDate, r]));
    expect(byDate.get(rollingDate)!.active).toBe(false);
    expect(byDate.get('2099-12-31')!.active).toBe(true);
  });

  test('disabling the curve keeps custom-horizon markets, deactivates curve markets', async () => {
    await seedWorkspace();
    const curveTP: TimePreference = { enabled: true, halfLife: 1, density: 3, customHorizons: ['2099-12-31'] };
    await seedMetric('m1', 'Curve Plus Custom', curveTP);
    await refreshRelativeDateMarkets(WS, { force: true });

    const curveDates = desiredMarketDates({ enabled: true, halfLife: 1, density: 3 });
    let rows = await marketsFor('m1');
    expect(rows).toHaveLength(curveDates.length + 1);

    await db.update(metrics)
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
      id: 'manual-1', workspaceId: WS, metricId: 'm-manual', metricName: 'No TP Metric',
      targetDate: '2099-06', rangeMin: 0, rangeMax: 50,
      shares: [0, 0], liquidity: 10, pool: 10,
      active: true, resolved: false, voided: false,
    });
    // A managed metric in the same workspace so the refresh has real work to do.
    await seedMetric('m-managed', 'Managed Metric', { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] });

    await refreshRelativeDateMarkets(WS, { force: true });

    const [manual] = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, WS), eq(markets.id, 'manual-1')));
    expect(manual.active).toBe(true);
    expect(manual.resolved).toBe(false);
    expect(manual.voided).toBe(false);
    expect(manual.rangeMax).toBe(50); // not voided/recreated despite the mismatch
  });

  test('managed metric with stale rangeMax still gets voided and recreated', async () => {
    await seedWorkspace();
    await seedMetric('m1', 'Managed', { enabled: false, halfLife: 1, customHorizons: ['2099-12-31'] }, 100);
    await db.insert(markets).values({
      id: 'stale-range', workspaceId: WS, metricId: 'm1', metricName: 'Managed',
      targetDate: '2099-12-31', rangeMin: 0, rangeMax: 50, // stale vs marketRangeMax=100
      shares: [0, 0], liquidity: 10, pool: 0,
      active: true, resolved: false, voided: false,
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
