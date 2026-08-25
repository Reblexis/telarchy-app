/**
 * A metric_logs row is a MEASUREMENT, not an audit trail of edits.
 *
 * Every reading in that table is drawn on the floor as "actual so far", and
 * settlement fixes on the last row at-or-before a market's boundary. So a row
 * written by an edit is a fabricated reading with real consequences.
 *
 * It happened: renaming "LookPilot revenue this week (USD)" on Monday
 * 2026-08-17 wrote a row stamping last week's $1,179.72 total inside the new
 * week, on the very metric whose resetsEvery declaration exists to keep other
 * periods' numbers off that chart.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
// The route is capability-gated; this spec is about what it writes, not who may.
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, metricLogs, metrics, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { metricsRouter } from '../routes/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-metric-log';
const OWNER = 'agent-metric-log';
const METRIC = 'metric-weekly';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = { workspaceId: WS, capabilities: new Set(['manage', 'read']), isMasterKey: true };
  next();
});
app.use('/api/metrics', metricsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-ml', balance: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Metric Log',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Revenue this week (USD)',
    value: 1_179.72,
    formula: '0',
    marketRangeMax: 8_000,
    resetsEvery: 'week',
    description: 'Resets every Monday.',
  });
});

const logs = () => db.select().from(metricLogs).where(eq(metricLogs.workspaceId, WS));
const put = (body: Record<string, unknown>) => request(app).put(`/api/metrics/${METRIC}`).send(body);

test('a rename writes no reading', async () => {
  const res = await put({ name: 'Net this week (USD)' });
  expect(res.status).toBe(200);
  expect(await logs()).toHaveLength(0);
  const [row] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, METRIC), eq(metrics.workspaceId, WS)));
  expect(row.name).toBe('Net this week (USD)');
});

test('a description, a range or a reset declaration writes no reading either', async () => {
  expect((await put({ description: 'Clearer words.' })).status).toBe(200);
  expect((await put({ marketRangeMax: 9_000 })).status).toBe(200);
  expect((await put({ resetsEvery: 'week' })).status).toBe(200);
  expect(await logs()).toHaveLength(0);
});

test('a new value writes exactly one reading, at the value given', async () => {
  const res = await put({ value: 240, oldValue: 1_179.72, updateNote: 'Monday sync' });
  expect(res.status).toBe(200);
  const rows = await logs();
  expect(rows).toHaveLength(1);
  expect(rows[0].value).toBeCloseTo(240, 6);
});

test('a formula change writes a reading, because the number itself moves', async () => {
  await db.insert(metrics).values({
    id: 'metric-composite',
    workspaceId: WS,
    name: 'Composite',
    value: 0,
    formula: '0',
    marketRangeMax: 1_000,
  });
  const res = await request(app)
    .put('/api/metrics/metric-composite')
    .send({ formula: '{Revenue this week (USD)} * 2' });
  expect(res.status).toBe(200);
  const rows = await db
    .select()
    .from(metricLogs)
    .where(and(eq(metricLogs.workspaceId, WS), eq(metricLogs.metricId, 'metric-composite')));
  expect(rows.length).toBeGreaterThan(0);
});

test('the workspace and its groups survive all of this', async () => {
  // Cheap guard that the harness fixture is real: a route that silently 404'd
  // would make every assertion above vacuous.
  expect(await db.select().from(workspaces).where(eq(workspaces.id, WS))).toHaveLength(1);
  expect((await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS))).length).toBeGreaterThan(
    0,
  );
});
