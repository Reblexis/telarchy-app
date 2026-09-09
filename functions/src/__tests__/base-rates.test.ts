/**
 * The base rates (docs/data-room.md, "The base rates are every weekly
 * reading"): what each metric the platform records about itself read at the
 * end of each of the last eight weeks.
 *
 * The block exists because "how far does this normally move in three weeks"
 * was answerable only by eye, off a chart with no numbers on it. What is
 * pinned here is that it publishes readings rather than a summary of them,
 * and that a week the sync did not run is a hole rather than a repeat of the
 * week before, which is the one thing a base rate must not get wrong.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { metricLogs, metrics, workspaces } from '../db/schema';
import { buildBaseRates } from '../services/base-rates';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const WS = 'ws-telarchy';
const days = (n: number) => n * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  process.env.SELF_SYNC_WORKSPACE_ID = WS;
  await db
    .insert(workspaces)
    .values([{ id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' }]);
  await db.insert(metrics).values([
    { id: 'm-traders', workspaceId: WS, name: 'Active traders', value: 9, formula: '0', order: 0 },
    { id: 'm-rev', workspaceId: WS, name: 'Telarchy revenue (USD)', value: 0, formula: '0', order: 1 },
  ]);
});

/** A reading of `metricId`, `ago` days before NOW. */
async function reading(id: string, metricId: string, value: number, ago: number) {
  await db.insert(metricLogs).values({
    id,
    workspaceId: WS,
    metricId,
    metricName: 'x',
    value,
    timestamp: new Date(NOW.getTime() - days(ago)),
  });
}

describe('the weekly readings', () => {
  test('eight weeks, oldest first, each labelled by the day it ends', async () => {
    const b = await buildBaseRates(NOW);
    expect(b.weeks).toHaveLength(8);
    expect(b.weeks[7]).toBe('2026-09-09');
    expect(b.weeks[6]).toBe('2026-09-02');
    expect(b.weeks[0]).toBe('2026-07-22');
  });

  test('a week reads what stood at the end of it, not the first thing in it', async () => {
    await reading('r1', 'm-traders', 3, 6);
    await reading('r2', 'm-traders', 9, 1);
    const b = await buildBaseRates(NOW);
    const traders = b.metrics.find(m => m.name === 'Active traders');
    expect(traders?.readings[7]).toBe(9);
  });

  test('a week with no reading is null, never the week before carried forward', async () => {
    await reading('r1', 'm-traders', 4, 20);
    const b = await buildBaseRates(NOW);
    const traders = b.metrics.find(m => m.name === 'Active traders');
    // Week index 5 holds the 20-day-old reading; the two weeks after it have
    // no reading of their own and say so.
    expect(traders?.readings[5]).toBe(4);
    expect(traders?.readings[6]).toBeNull();
    expect(traders?.readings[7]).toBeNull();
  });

  test('a reading older than the eight weeks never leaks into a week', async () => {
    await reading('old', 'm-traders', 99, 70);
    await reading('new', 'm-rev', 0, 2);
    const b = await buildBaseRates(NOW);
    // The old reading is outside every week, so its metric has nothing to
    // publish and is left out rather than drawn as a flat line at 99.
    expect(b.metrics.map(m => m.name)).toEqual(['Telarchy revenue (USD)']);
  });

  test('a metric with no reading at all in the window is not listed', async () => {
    await reading('r1', 'm-traders', 5, 2);
    const b = await buildBaseRates(NOW);
    expect(b.metrics.map(m => m.name)).toEqual(['Active traders']);
  });

  test('the metric carries its current name, not the one frozen into the log row', async () => {
    await reading('r1', 'm-traders', 5, 2);
    const b = await buildBaseRates(NOW);
    expect(b.metrics[0].name).toBe('Active traders');
  });

  test('metrics keep the order the floor puts them in', async () => {
    await reading('r1', 'm-rev', 0, 2);
    await reading('r2', 'm-traders', 5, 2);
    const b = await buildBaseRates(NOW);
    expect(b.metrics.map(m => m.name)).toEqual(['Active traders', 'Telarchy revenue (USD)']);
  });
});

describe('an instance that measures somebody else', () => {
  test('publishes an empty block rather than another workspace’s numbers', async () => {
    process.env.SELF_SYNC_WORKSPACE_ID = '';
    await reading('r1', 'm-traders', 5, 2);
    const b = await buildBaseRates(NOW);
    expect(b.metrics).toEqual([]);
    expect(b.weeks).toHaveLength(8);
  });
});
