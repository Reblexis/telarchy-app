/**
 * "Profitable forecasters" (docs/metrics.md): participants at or above 100
 * credits of marked-to-market profit over the trailing 30 days' resolutions
 * and every open market, house excluded. The arithmetic is the board's; what
 * is pinned here is the window, the threshold, the house rule and that
 * unsettled profit counts, which is what the owner asked for on 2026-09-08.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const marked = jest.fn(async (): Promise<Map<string, number>> => new Map());
jest.mock('../lib/board', () => ({
  loadSeasonMarked: (...args: unknown[]) => marked(...(args as [])),
}));

import { agents, workspaces } from '../db/schema';
import { PROFITABLE_FORECASTER_MIN_CREDITS, profitableForecasters30d } from '../services/platform-stats';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  marked.mockReset();
  marked.mockResolvedValue(new Map());
  await db.insert(agents).values([
    { id: 'human', apiKeyHash: 'h1', balance: 0 },
    { id: 'bot', apiKeyHash: 'h2', balance: 0 },
    { id: 'viktor', apiKeyHash: 'h3', balance: 0, platformAdmin: true },
    { id: 'adminbot', apiKeyHash: 'h4', balance: 0, platformOperated: true },
  ]);
  await db.insert(workspaces).values([
    { id: 'ws-a', name: 'A', createdBy: 'viktor', visibility: 'public' },
    { id: 'ws-b', name: 'B', createdBy: 'human', visibility: 'private' },
  ]);
});

describe('profitableForecasters30d', () => {
  test('the threshold is 100 credits of profit, and a bot counts exactly like a human', async () => {
    expect(PROFITABLE_FORECASTER_MIN_CREDITS).toBe(100);
    marked.mockResolvedValue(
      new Map([
        ['human', 100],
        ['bot', 250.5],
        ['nearly', 99.99],
        ['loser', -40],
      ]),
    );
    expect(await profitableForecasters30d()).toBe(2);
  });

  test('house accounts never count, however profitable', async () => {
    marked.mockResolvedValue(
      new Map([
        ['viktor', 10_000],
        ['adminbot', 5_000],
        ['human', 120],
      ]),
    );
    expect(await profitableForecasters30d()).toBe(1);
  });

  test('the window is the trailing 30 days of resolutions and every open market, over every workspace', async () => {
    const now = new Date('2026-09-08T12:00:00Z');
    await profitableForecasters30d(now);
    expect(marked).toHaveBeenCalledTimes(1);
    const [wsIds, start, end] = marked.mock.calls[0] as unknown as [string[], Date, Date];
    expect([...wsIds].sort()).toEqual(['ws-a', 'ws-b']);
    expect(start.toISOString()).toBe('2026-08-09T12:00:00.000Z');
    // The end is far enough out that an open market settling next year is
    // still marked: unsettled profit counts.
    expect(end.getTime() - now.getTime()).toBeGreaterThanOrEqual(365 * 24 * 60 * 60 * 1000);
  });

  test('nobody profitable is zero, not an error', async () => {
    expect(await profitableForecasters30d()).toBe(0);
  });
});
