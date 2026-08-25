/**
 * HTTP-level tests for the agent control plane:
 *   GET  /api/admin/agent-controls   (platform admin / master key)
 *   POST /api/admin/agent-control    (platform admin / master key)
 *
 * Verifies the platform gate, the upsert semantics, and the
 * trigger-request/ack handshake the runners rely on.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      isMasterKey: req.headers['x-master-key'] === '1',
      uid: req.headers['x-user-id'] as string | undefined,
      agentId: req.headers['x-agent-id'] as string | undefined,
      workspaceId: req.headers['x-workspace-id'] as string | undefined,
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
import { AppError } from '../lib/errors';
import { adminRouter } from '../routes/admin';
import { ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
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

describe('agent control plane', () => {
  it('rejects non-platform callers', async () => {
    await request(app).get('/api/admin/agent-controls').expect(403);
    await request(app)
      .post('/api/admin/agent-control')
      .send({ agentId: 'impact-analyst', desiredState: 'paused' })
      .expect(403);
  });

  it('upserts desired state and lists it', async () => {
    const post = await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'impact-analyst', desiredState: 'paused' })
      .expect(200);
    expect(post.body.desiredState).toBe('paused');

    const list = await request(app).get('/api/admin/agent-controls').set('x-master-key', '1').expect(200);
    expect(list.body.controls).toHaveLength(1);
    expect(list.body.controls[0]).toMatchObject({ agentId: 'impact-analyst', desiredState: 'paused' });

    // Flip back to enabled on the same row (upsert, not insert).
    await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'impact-analyst', desiredState: 'enabled' })
      .expect(200);
    const after = await request(app).get('/api/admin/agent-controls').set('x-master-key', '1').expect(200);
    expect(after.body.controls).toHaveLength(1);
    expect(after.body.controls[0].desiredState).toBe('enabled');
  });

  it('rejects bad desiredState and empty updates', async () => {
    await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'impact-analyst', desiredState: 'stopped' })
      .expect(400);
    await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'impact-analyst' })
      .expect(400);
  });

  it('handles the trigger request/ack handshake', async () => {
    // UI requests a cycle.
    const trig = await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'skeptic', trigger: true })
      .expect(200);
    expect(trig.body.triggerRequestedAt).toBeTruthy();
    expect(trig.body.triggerAckedAt).toBeNull();

    // Runner sees requested > acked, fires, then acks.
    const ack = await request(app)
      .post('/api/admin/agent-control')
      .set('x-master-key', '1')
      .send({ agentId: 'skeptic', ackTrigger: true })
      .expect(200);
    expect(new Date(ack.body.triggerAckedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(ack.body.triggerRequestedAt).getTime(),
    );
    // desiredState untouched by trigger traffic.
    expect(ack.body.desiredState).toBe('enabled');
  });
});
