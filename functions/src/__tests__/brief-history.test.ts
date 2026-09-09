/**
 * The history in the workspace brief (docs/vision.md, "The workspace brief").
 *
 * The brief is what an outside agent reads to price a floor, and it carried
 * the last 24 readings. Readings are hourly, so that was one day: an agent
 * asked to forecast the end of the month was handed a flat line one day long,
 * while the page beside it drew six weeks. The brief now carries one point a
 * day over the whole series.
 *
 * Named after what a forecaster needs: enough history to see a trend, and a
 * point that means "what it read at the end of that day" rather than "some
 * reading from that day".
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { metricLogs, metrics, permissionGroups, workspaces } from '../db/schema';
import { BRIEF_HISTORY_DAYS, buildWorkspaceContext } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-hist';
const M = 'm1';
const NOW = new Date('2026-09-09T23:00:00.000Z');
const hours = (n: number) => n * 60 * 60 * 1000;
const days = (n: number) => n * 24 * hours(1);

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  await db
    .insert(workspaces)
    .values([{ id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' }]);
  await db
    .insert(permissionGroups)
    .values([
      { id: 'g-pub', workspaceId: WS, name: 'Public', type: 'public', capabilities: ['read'], sourcePermissions: {} },
    ]);
  await db.insert(metrics).values([{ id: M, workspaceId: WS, name: 'Active traders', value: 9, formula: '0' }]);
});

async function reading(id: string, value: number, at: Date) {
  await db
    .insert(metricLogs)
    .values({ id, workspaceId: WS, metricId: M, metricName: 'Active traders', value, timestamp: at });
}

async function history() {
  const ctx = await buildWorkspaceContext(WS);
  return ctx?.metrics[0].history ?? [];
}

describe('one point a day, over the whole series', () => {
  test('a day of hourly readings is one point, not twenty-four', async () => {
    // Twenty-four readings, all inside one day, which is what the hourly sync
    // writes and what the brief used to publish as its whole history.
    for (let h = 0; h < 24; h++) await reading(`r${h}`, h, new Date(NOW.getTime() - hours(h)));
    const h = await history();
    expect(h).toHaveLength(1);
    expect(h[0].at).toBe('2026-09-09');
  });

  test('the point is what the number read at the END of that day', async () => {
    await reading('early', 3, new Date('2026-09-08T01:00:00.000Z'));
    await reading('late', 9, new Date('2026-09-08T22:00:00.000Z'));
    const h = await history();
    expect(h).toEqual([{ at: '2026-09-08', value: 9 }]);
  });

  test('six weeks of readings are six weeks of points, oldest first', async () => {
    for (let d = 0; d < 42; d++) await reading(`d${d}`, d, new Date(NOW.getTime() - days(d)));
    const h = await history();
    expect(h).toHaveLength(42);
    expect(h[0].at < h[h.length - 1].at).toBe(true);
    // The newest point is the newest reading, not the oldest one.
    expect(h[h.length - 1].value).toBe(0);
  });

  test('the series is capped, and what survives the cap is the recent end', async () => {
    const older = BRIEF_HISTORY_DAYS + 10;
    for (let d = 0; d < older; d++) await reading(`d${d}`, d, new Date(NOW.getTime() - days(d)));
    const h = await history();
    expect(h.length).toBeLessThanOrEqual(BRIEF_HISTORY_DAYS);
    expect(h[h.length - 1].value).toBe(0);
  });

  test('a metric nobody has read yet has an empty history, not a fabricated point', async () => {
    expect(await history()).toEqual([]);
  });
});

describe('how long it has been running', () => {
  test('a workspace that never set a start date says when its numbers started being read', async () => {
    await reading('first', 1, new Date('2026-08-01T10:00:00.000Z'));
    await reading('last', 9, new Date('2026-09-08T10:00:00.000Z'));
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.runningSince).toBe('2026-08-01');
  });

  test('the owner’s own start date wins over the first reading', async () => {
    await db.update(workspaces).set({ telarchyStartedOn: new Date('2026-07-04T00:00:00.000Z') });
    await reading('first', 1, new Date('2026-08-01T10:00:00.000Z'));
    const ctx = await buildWorkspaceContext(WS);
    expect(ctx?.runningSince).toBe('2026-07-04');
  });
});
