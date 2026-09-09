/**
 * The series the data room draws (docs/data-room.md, "How the page draws
 * things").
 *
 * A number with a history is drawn over time, so the feed has to carry that
 * history: one point per day, the reading that stood at the end of it, and a
 * day nobody measured left out rather than filled in. The trading series is
 * the same shape for the activity behind the trader count.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, metricLogs, metrics, trades, workspaces } from '../db/schema';
import { buildBaseRates } from '../services/base-rates';
import { buildTradingByDay } from '../services/trading-by-day';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const WS = 'ws-telarchy';
const OTHER = 'ws-private';
const days = (n: number) => n * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  process.env.SELF_SYNC_WORKSPACE_ID = WS;
  await db.insert(agents).values([
    { id: 'a1', apiKeyHash: 'h1', balance: 0 },
    { id: 'a2', apiKeyHash: 'h2', balance: 0 },
  ]);
  await db.insert(workspaces).values([
    { id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'a1', visibility: 'public' },
    { id: OTHER, name: 'Private', slug: 'private', createdBy: 'a1', visibility: 'private' },
  ]);
  await db
    .insert(metrics)
    .values([{ id: 'm1', workspaceId: WS, name: 'Active traders', value: 9, formula: '0', order: 0 }]);
});

async function reading(id: string, value: number, at: Date) {
  await db
    .insert(metricLogs)
    .values({ id, workspaceId: WS, metricId: 'm1', metricName: 'Active traders', value, timestamp: at });
}

async function trade(
  id: string,
  opts: { agentId?: string; credits?: number; ago: number; kind?: string; ws?: string },
) {
  await db.insert(trades).values({
    id,
    workspaceId: opts.ws ?? WS,
    agentId: opts.agentId ?? 'a1',
    marketId: 'mkt',
    direction: 'higher',
    shares: 1,
    cost: opts.credits ?? 10,
    kind: opts.kind ?? 'trade',
    createdAt: new Date(NOW.getTime() - days(opts.ago)),
  });
}

describe('a metric is drawn over time, a point a day', () => {
  test('a day of hourly readings is one point: what it read at the end of that day', async () => {
    await reading('r1', 3, new Date('2026-09-08T01:00:00Z'));
    await reading('r2', 9, new Date('2026-09-08T22:00:00Z'));
    const b = await buildBaseRates(NOW);
    expect(b.metrics[0].daily).toEqual([{ at: '2026-09-08', value: 9 }]);
  });

  test('the days run oldest first, so a chart can draw them in order', async () => {
    for (let d = 0; d < 5; d++) await reading(`r${d}`, d, new Date(NOW.getTime() - days(d)));
    const b = await buildBaseRates(NOW);
    const daily = b.metrics[0].daily;
    expect(daily.map(p => p.at)).toEqual([...daily.map(p => p.at)].sort());
    expect(daily[daily.length - 1].value).toBe(0);
  });

  test('a day nobody measured is absent, never filled in with the day before', async () => {
    await reading('r1', 4, new Date(NOW.getTime() - days(4)));
    await reading('r2', 7, new Date(NOW.getTime() - days(1)));
    const b = await buildBaseRates(NOW);
    expect(b.metrics[0].daily).toHaveLength(2);
  });

  test('the weekly readings the block always carried are still there beside it', async () => {
    await reading('r1', 7, new Date(NOW.getTime() - days(1)));
    const b = await buildBaseRates(NOW);
    expect(b.weeks).toHaveLength(8);
    expect(b.metrics[0].readings[7]).toBe(7);
  });
});

describe('the trading behind the trader count, over time', () => {
  test('a day carries its trades, its credits and how many people made them', async () => {
    await trade('t1', { ago: 1, credits: 40 });
    await trade('t2', { ago: 1, credits: -60, agentId: 'a2' });
    const t = await buildTradingByDay(NOW);
    const day = t.byDay.find(d => d.day === '2026-09-08');
    expect(day).toEqual({ day: '2026-09-08', trades: 2, credits: 100, traders: 2 });
  });

  test('a sell counts as trading, the same as a buy', async () => {
    await trade('t1', { ago: 1, credits: -150 });
    const t = await buildTradingByDay(NOW);
    expect(t.byDay.find(d => d.day === '2026-09-08')?.credits).toBe(150);
  });

  test('a redemption is bookkeeping, not a trade anyone placed', async () => {
    await trade('t1', { ago: 1, credits: 30 });
    await trade('r1', { ago: 1, credits: -30, kind: 'redeem' });
    const t = await buildTradingByDay(NOW);
    expect(t.byDay.find(d => d.day === '2026-09-08')).toEqual({
      day: '2026-09-08',
      trades: 1,
      credits: 30,
      traders: 1,
    });
  });

  test('a private workspace’s trading is not published', async () => {
    await trade('t1', { ago: 1, credits: 30, ws: OTHER });
    expect((await buildTradingByDay(NOW)).byDay.every(d => d.trades === 0 && d.credits === 0 && d.traders === 0)).toBe(
      true,
    );
  });

  test('QUIET DAYS ARE REAL ZEROS inside the query coverage', async () => {
    await trade('t1', { ago: 3, credits: 10 });
    await trade('t2', { ago: 1, credits: 10 });
    const t = await buildTradingByDay(NOW);
    expect(t.byDay.slice(-4)).toEqual([
      { day: '2026-09-06', trades: 1, credits: 10, traders: 1 },
      { day: '2026-09-07', trades: 0, credits: 0, traders: 0 },
      { day: '2026-09-08', trades: 1, credits: 10, traders: 1 },
      { day: '2026-09-09', trades: 0, credits: 0, traders: 0 },
    ]);
  });

  test('an empty query still publishes every covered UTC date', async () => {
    const t = await buildTradingByDay(NOW);
    expect(t.byDay).toHaveLength(121); // 120 trailing days touch 121 UTC dates at noon.
    expect(t.byDay[0].day).toBe('2026-05-12');
    expect(t.byDay[120].day).toBe('2026-09-09');
    expect((await buildTradingByDay(NOW)).byDay.every(d => d.trades === 0 && d.credits === 0 && d.traders === 0)).toBe(
      true,
    );
  });
});

test('DATES OUTSIDE QUERY COVERAGE ARE ABSENT and boundary dates contain only covered trades', async () => {
  await trade('too-old', { ago: 120, credits: 99 });
  await trade('first', { ago: 120 - 1 / 24, credits: 10 });
  await trade('last', { ago: 0, credits: 20 });
  await trade('future', { ago: -1, credits: 99 });
  const { byDay } = await buildTradingByDay(NOW);
  expect(byDay).toHaveLength(121);
  expect(byDay[0]).toEqual({ day: '2026-05-12', trades: 1, credits: 10, traders: 1 });
  expect(byDay[120]).toEqual({ day: '2026-09-09', trades: 1, credits: 20, traders: 1 });
});
