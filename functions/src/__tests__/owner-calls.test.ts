/**
 * The owner's own call (docs/owner-on-the-floor.md, "The owner's own call"):
 * what the owner expects a metric to read at a date, published beside what
 * the market says.
 *
 * Its whole value is that it was made before the answer was known, so the one
 * rule that matters is append-only: a call is never edited, a second one is a
 * second row, and the floor can always show how many stand behind the newest.
 * A forecast that can be quietly rewritten afterwards is not a forecast.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, metrics, workspaces } from '../db/schema';
import { latestOwnerCalls, recordOwnerCall } from '../services/owner-calls';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-calls';
const OWNER = 'viktor';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h', balance: 0, nickname: 'viktor' }]);
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values([
    { id: 'm1', workspaceId: WS, name: 'Active traders', value: 9, formula: '0' },
    { id: 'm2', workspaceId: WS, name: 'Revenue', value: 0, formula: '0' },
  ]);
});

describe('recording one', () => {
  test('a call is a metric, a date and a number', async () => {
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 15 }, OWNER);
    const calls = await latestOwnerCalls(WS);
    expect(calls).toEqual([
      expect.objectContaining({ metricId: 'm1', targetDate: '2026-09-30', value: 15, revisions: 0, by: 'viktor' }),
    ]);
  });

  test('a call on a metric this floor does not define is refused', async () => {
    await expect(
      recordOwnerCall(WS, { metricId: 'not-ours', targetDate: '2026-09-30', value: 1 }, OWNER),
    ).rejects.toThrow(/metric/i);
  });

  test('a value that is not a number is refused rather than stored as one', async () => {
    await expect(
      recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: Number.NaN }, OWNER),
    ).rejects.toThrow(/value/i);
  });

  test('a date is required, because a call without one says nothing', async () => {
    await expect(recordOwnerCall(WS, { metricId: 'm1', targetDate: '', value: 3 }, OWNER)).rejects.toThrow(/date/i);
  });
});

describe('calls are append-only', () => {
  test('a second call on the same metric and date does not overwrite the first', async () => {
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 15 }, OWNER);
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 11 }, OWNER);
    const [call] = await latestOwnerCalls(WS);
    expect(call.value).toBe(11);
    // The earlier one is still on the record, and the floor can say so.
    expect(call.revisions).toBe(1);
  });

  test('the newest call is the one the floor shows, whatever order they were written in', async () => {
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 15 }, OWNER, new Date('2026-09-01'));
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 20 }, OWNER, new Date('2026-09-05'));
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 12 }, OWNER, new Date('2026-09-03'));
    const [call] = await latestOwnerCalls(WS);
    expect(call.value).toBe(20);
    expect(call.revisions).toBe(2);
  });
});

describe('one call per metric and date', () => {
  test('two dates on one metric are two calls', async () => {
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 15 }, OWNER);
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-10-31', value: 22 }, OWNER);
    const calls = await latestOwnerCalls(WS);
    expect(calls.map(c => [c.targetDate, c.value]).sort()).toEqual([
      ['2026-09-30', 15],
      ['2026-10-31', 22],
    ]);
  });

  test('two metrics on one date are two calls', async () => {
    await recordOwnerCall(WS, { metricId: 'm1', targetDate: '2026-09-30', value: 15 }, OWNER);
    await recordOwnerCall(WS, { metricId: 'm2', targetDate: '2026-09-30', value: 0 }, OWNER);
    expect(await latestOwnerCalls(WS)).toHaveLength(2);
  });

  test('another floor’s calls are not this floor’s', async () => {
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', slug: 'other', createdBy: OWNER, visibility: 'public' });
    await db.insert(metrics).values([{ id: 'm3', workspaceId: 'ws-other', name: 'Theirs', value: 0, formula: '0' }]);
    await recordOwnerCall('ws-other', { metricId: 'm3', targetDate: '2026-09-30', value: 99 }, OWNER);
    expect(await latestOwnerCalls(WS)).toEqual([]);
  });
});
