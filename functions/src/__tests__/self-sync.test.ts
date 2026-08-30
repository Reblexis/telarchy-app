/**
 * The hourly self-sync records a READING, not a diff.
 *
 * "Telarchy revenue (USD)" held a single point on its chart from the day it
 * was created (2026-08-25) to 2026-08-30 with nothing under the cursor,
 * because the old sync wrote only when the number moved and the number was $0
 * every hour. An unchanged number that was genuinely re-measured is a
 * measurement; what an unchanged number is not is news, so the updates feed
 * and the event stay gated on an actual change.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const stats = {
  marketsActive: 0,
  agentsActive: 0,
  tradesThisWeek: 0,
  weeklyActiveVerifiedTraders: 4,
  manifoldImportCount: 0,
  revenue30dUsd: 0,
};
jest.mock('../services/platform-stats', () => ({
  platformStats: jest.fn(async () => stats),
}));

import { and, eq } from 'drizzle-orm';
import { agents, events, metricLogs, metrics, updates } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { syncSelfMetrics } from '../services/self-sync';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-self-sync';
const OWNER = 'agent-self-sync';
const TRADERS = 'metric-traders';
const REVENUE = 'metric-revenue';
const VALUATION = 'metric-valuation';

const logsFor = (metricId: string) =>
  db
    .select()
    .from(metricLogs)
    .where(and(eq(metricLogs.workspaceId, WS), eq(metricLogs.metricId, metricId)));

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  process.env.SELF_SYNC_WORKSPACE_ID = WS;
  stats.weeklyActiveVerifiedTraders = 4;
  stats.revenue30dUsd = 0;
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-ss', balance: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Telarchy',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values([
    { id: TRADERS, workspaceId: WS, name: 'Active traders', value: 4, formula: '0', marketRangeMax: 50 },
    { id: REVENUE, workspaceId: WS, name: 'Telarchy revenue (USD)', value: 0, formula: '0', marketRangeMax: 1_000 },
    {
      id: VALUATION,
      workspaceId: WS,
      name: 'Implied valuation (USD)',
      value: 0,
      formula: '0',
      marketRangeMax: 20_000_000,
      resolvesNaUntilMeasured: true,
    },
  ]);
});

afterEach(() => {
  delete process.env.SELF_SYNC_WORKSPACE_ID;
});

test('an unchanged number is still recorded as a reading, every run', async () => {
  await syncSelfMetrics();
  await syncSelfMetrics();
  await syncSelfMetrics();

  const rows = await logsFor(REVENUE);
  expect(rows).toHaveLength(3);
  expect(rows.every(r => r.value === 0)).toBe(true);
  expect(await logsFor(TRADERS)).toHaveLength(3);
});

test('an unchanged number writes no updates-feed row and no event', async () => {
  await syncSelfMetrics();
  expect(await db.select().from(updates).where(eq(updates.workspaceId, WS))).toHaveLength(0);
  const evs = await db.select().from(events).where(eq(events.workspaceId, WS));
  expect(evs.filter(e => e.type === 'metric:updated')).toHaveLength(0);
});

test('a changed number moves the metric and announces it once', async () => {
  stats.weeklyActiveVerifiedTraders = 9;
  stats.revenue30dUsd = 25;
  const result = await syncSelfMetrics();

  expect(result.readings.map(r => r.changed)).toEqual([true, true]);
  const [traders] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, TRADERS), eq(metrics.workspaceId, WS)));
  expect(traders.value).toBe(9);
  const [revenue] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, REVENUE), eq(metrics.workspaceId, WS)));
  expect(revenue.value).toBe(25);

  const feed = await db.select().from(updates).where(eq(updates.workspaceId, WS));
  expect(feed).toHaveLength(2);
  expect(feed.map(u => u.newValue).sort((a, b) => a - b)).toEqual([9, 25]);
});

test('a metric the platform does not compute is never touched', async () => {
  // Implied valuation resolves N/A until its first reading exists, and that
  // state ends for good the moment one is written. A sync that "updated every
  // metric" would settle every open market on it against a number that has
  // never been measured.
  await syncSelfMetrics();
  expect(await logsFor(VALUATION)).toHaveLength(0);
});

test('unconfigured, it does nothing at all', async () => {
  delete process.env.SELF_SYNC_WORKSPACE_ID;
  const result = await syncSelfMetrics();
  expect(result.skipped).toMatch(/SELF_SYNC_WORKSPACE_ID/);
  expect(result.readings).toHaveLength(0);
  expect(await logsFor(REVENUE)).toHaveLength(0);
});
