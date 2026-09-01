jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { markets, metricLogs, metrics, workspaces } from '../db/schema';
import { settlementInstantFor, settlesOn } from '../lib/date-utils';
import { refreshRelativeDateMarkets } from '../services/markets';
import { getAllMetrics, logSpecificMetrics } from '../services/metrics';
import { resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

/**
 * Settling after the period rather than at the instant it ends (owner ask
 * 2026-08-31, docs/guides/sources.md: "The number is final after the period,
 * not at it").
 *
 * The pair of rules this pins: a market becomes DUE at its period end plus
 * the metric's lag, and it still settles on the last reading at or before its
 * PERIOD END. Together they are what makes a monthly total possible at all:
 * the number is typed after the month, dated into it, and the market settles
 * on it.
 */

const WS = 'ws-settle-after';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values({ id: WS, name: 'Lag', createdBy: 'owner', visibility: 'private' });
});

describe('the instant', () => {
  test('with no lag it is the period end, exactly as before', () => {
    expect(settlementInstantFor('2026-09', 0).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('with a lag it is that far after it', () => {
    expect(settlementInstantFor('2026-09', 3 * 24 * 60).toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  test('a market that carries no stamp settles at its period end', () => {
    expect(settlesOn({ targetDate: '2026-09' })).toBe('2026-10-01T00:00:00Z');
    expect(settlesOn({ targetDate: '2026-09', settlesAt: new Date('2026-10-04T00:00:00Z') })).toBe(
      '2026-10-04T00:00:00Z',
    );
  });
});

describe('a market opened on a metric with a lag', () => {
  test('stamps the lagged instant, and keeps it when the metric changes later', async () => {
    await db.insert(metrics).values({
      id: 'm1',
      workspaceId: WS,
      name: 'Monthly revenue',
      value: 0,
      formula: '0',
      marketRangeMax: 100000,
      settlementLagMinutes: 3 * 24 * 60,
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-09'] },
    });
    await refreshRelativeDateMarkets(WS, { force: true });

    const [opened] = await db.select().from(markets).where(eq(markets.metricId, 'm1'));
    expect(opened.settlesAt?.toISOString()).toBe('2026-10-04T00:00:00.000Z');

    // A market people are trading cannot have its settlement moved under them,
    // so the stamp is the market's, not the metric's.
    await db
      .update(metrics)
      .set({ settlementLagMinutes: 30 * 24 * 60 })
      .where(eq(metrics.id, 'm1'));
    await refreshRelativeDateMarkets(WS, { force: true });
    const [still] = await db.select().from(markets).where(eq(markets.id, opened.id));
    expect(still.settlesAt?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
});

describe('the number typed after the month', () => {
  test('is dated into the month, and the market settles on it', async () => {
    await db.insert(metrics).values({
      id: 'm1',
      workspaceId: WS,
      name: 'Monthly revenue',
      value: 4812,
      formula: '0',
      marketRangeMax: 100000,
      settlementLagMinutes: 3 * 24 * 60,
    });
    await db.insert(markets).values({
      id: 'mk1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Monthly revenue',
      targetDate: '2026-09',
      rangeMin: 0,
      rangeMax: 100000,
      shares: [0, 0],
      liquidity: 200,
      pool: 138.6,
      active: true,
      resolved: false,
      voided: false,
      settlesAt: new Date('2026-10-04T00:00:00Z'),
    });

    // Amended 2026-09-01: this used to assert the market waited out its lag
    // even once September's number was in. A market resolves on its READING
    // now, so the answer arriving is what settles it and the lag is only the
    // deadline for giving up (docs/market-integrity.md, "A market resolves on
    // its reading, not on a clock").

    // 1 October, September's number not yet typed: the question is still open.
    await resolvePredictions('2026-10-01', WS);
    const [beforeTheNumber] = await db.select().from(markets).where(eq(markets.id, 'mk1'));
    expect(beforeTheNumber.resolved).toBe(false);

    // Typed on 3 October, dated to the last moment of September.
    const all = await getAllMetrics(WS);
    await logSpecificMetrics(['m1'], all, WS, new Date('2026-09-30T23:59:00Z'));
    const [logged] = await db.select().from(metricLogs).where(eq(metricLogs.metricId, 'm1'));
    expect(logged.timestamp.toISOString()).toBe('2026-09-30T23:59:00.000Z');

    // And it settles on it, without waiting the rest of the lag out.
    await resolvePredictions('2026-10-03', WS);
    const [settled] = await db.select().from(markets).where(eq(markets.id, 'mk1'));
    expect(settled.resolved).toBe(true);
    expect(settled.actualValue).toBe(4812);
    expect(settled.settledReadingAt?.toISOString()).toBe('2026-09-30T23:59:00.000Z');
  });
});
