/**
 * GET /api/metrics returns the two per-metric settings the metric sheet
 * shows (docs/owner-on-the-floor.md, dialog 1): how long after a period the
 * number is final, and the credits a new book opens with. Before 2026-09-03
 * the list dropped both, so the sheet could only show fallbacks.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, metrics, workspaces } from '../db/schema';
import { getAllMetrics } from '../services/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-list-fields';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'o-list', apiKeyHash: 'h-list', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'L', createdBy: 'o-list', visibility: 'public' });
});

test('the list carries settlementLagMinutes and liquidityCredits as stored', async () => {
  await db.insert(metrics).values({
    id: 'm1',
    workspaceId: WS,
    name: 'Revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
    settlementLagMinutes: 3 * 24 * 60,
    liquidityCredits: 250,
  });
  const [m] = await getAllMetrics(WS);
  expect(m.settlementLagMinutes).toBe(4320);
  expect(m.liquidityCredits).toBe(250);
});

test('a metric with no credits of its own reports null, so the client falls back to the workspace default', async () => {
  await db
    .insert(metrics)
    .values({ id: 'm2', workspaceId: WS, name: 'R', value: 0, formula: '0', marketRangeMax: 1000 });
  const [m] = await getAllMetrics(WS);
  expect(m.settlementLagMinutes).toBe(0);
  expect(m.liquidityCredits).toBeNull();
});
