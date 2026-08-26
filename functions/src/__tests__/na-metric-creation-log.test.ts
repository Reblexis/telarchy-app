/**
 * A metric's creation is not a reading. A metric declared
 * resolvesNaUntilMeasured logs nothing at POST, so the N/A rule (no reading
 * at or before a market's instant means void, not "$0") holds from day one.
 * On 2026-08-25 the creation log counted as a reading and the daily
 * valuation markets would have settled at $0 at midnight.
 */
jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, metricLogs } from '../db/schema';
import { provisionWorkspace } from '../lib/participants';
import { metricsRouter } from '../routes/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-na-create';
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: 'owner-na-create',
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'owner-na-create', apiKeyHash: 'h-na-create', balance: 0 });
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'NA',
    createdBy: 'owner-na-create',
    ownerAgentId: 'owner-na-create',
    visibility: 'private',
  });
});

test('a never-measured metric has no reading after creation; an ordinary one has its first', async () => {
  const na = await request(app)
    .post('/api/metrics')
    .send({ name: 'Implied valuation (USD)', value: 0, formula: '0', resolvesNaUntilMeasured: true });
  expect(na.status).toBeLessThan(300);
  const ordinary = await request(app).post('/api/metrics').send({ name: 'Revenue (USD)', value: 12, formula: '0' });
  expect(ordinary.status).toBeLessThan(300);

  const naLogs = await db.select().from(metricLogs).where(eq(metricLogs.metricId, na.body.id));
  const ordLogs = await db.select().from(metricLogs).where(eq(metricLogs.metricId, ordinary.body.id));
  expect(naLogs.length).toBe(0);
  expect(ordLogs.length).toBe(1);
  expect(ordLogs[0].value).toBe(12);
});
