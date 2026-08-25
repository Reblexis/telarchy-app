/**
 * POST /api/admin/agent-traces enforces its own documented cap.
 *
 * The "~25 most-informative rows" line in /api/help was a convention only;
 * the route accepted any array, and agent_traces reached 426k rows / 2.9 GB
 * on a db-f1-micro (2026-08-20). Now: at most 40 entry rows and 64 KB of
 * entries JSON, refused with a 400 that says so, so a runner that overslices
 * finds out on the first push instead of in next month's disk bill.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      isMasterKey: req.headers['x-master-key'] === '1',
      uid: undefined,
      agentId: 'runner',
      workspaceId: 'ws1',
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { agentTraces } from '../db/schema';
import { AppError } from '../lib/errors';
import { adminRouter } from '../routes/admin';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json({ limit: '1mb' }));
const { authMiddleware } = require('../middleware/auth');
app.use('/api/admin', authMiddleware, adminRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
});

function tracePayload(entries: unknown[]) {
  return {
    workspaceId: 'ws1',
    agentId: 'runner',
    strategy: 'test',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    entries,
  };
}

describe('agent-trace entries cap', () => {
  it('accepts a trace at the row cap and stores it', async () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ marketId: `m${i}`, reasoning: 'ok' }));
    await request(app).post('/api/admin/agent-traces').set('x-master-key', '1').send(tracePayload(entries)).expect(201);
    const rows = await db.select().from(agentTraces);
    expect(rows).toHaveLength(1);
    expect(rows[0].entries as unknown[]).toHaveLength(40);
  });

  it('refuses more than 40 entry rows with a 400 naming the cap', async () => {
    const entries = Array.from({ length: 41 }, (_, i) => ({ marketId: `m${i}` }));
    const res = await request(app)
      .post('/api/admin/agent-traces')
      .set('x-master-key', '1')
      .send(tracePayload(entries))
      .expect(400);
    expect(res.body.error).toContain('40');
    expect(await db.select().from(agentTraces)).toHaveLength(0);
  });

  it('refuses oversized entries JSON even at a legal row count', async () => {
    const entries = [{ marketId: 'm1', reasoning: 'x'.repeat(70 * 1024) }];
    const res = await request(app)
      .post('/api/admin/agent-traces')
      .set('x-master-key', '1')
      .send(tracePayload(entries))
      .expect(400);
    expect(res.body.error).toContain('64 KB');
    expect(await db.select().from(agentTraces)).toHaveLength(0);
  });
});
