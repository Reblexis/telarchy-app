/**
 * The conversation outlives the decision (docs/vision.md, owner ask
 * 2026-08-20): a decided contract's thread stays open, because what a
 * decision pauses is trading, not the talk about the outcome. The floor
 * renders the comment box on approved and declined contracts, so this
 * pins the guarantee it leans on: posting a message to a proposal in any
 * decided status still lands.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import { agents, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
// The router no longer carries auth itself (app.ts applies the policy first),
// so the test mounts the mocked middleware where the policy would run.
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-decided-thread';

async function seed(status: string) {
  await db.insert(agents).values([{ id: 'agent-dt', apiKeyHash: 'h-dt', balance: 0, nickname: 'dana' }]);
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Decided Thread WS', createdBy: 'agent-dt', visibility: 'public' });
  await db.insert(proposals).values({
    id: `prop-${status}`,
    workspaceId: WS,
    proposedBy: 'agent-dt',
    title: 'Rewrite the store page',
    status,
  });
}

function post(proposalId: string, content: string) {
  return request(app)
    .post(`/api/proposals/${proposalId}/messages`)
    .set('X-Test-Agent-Id', 'agent-dt')
    .set('X-Workspace-Id', WS)
    .set('Content-Type', 'application/json')
    .send({ content });
}

describe('a decided contract keeps its thread open', () => {
  test.each(['approved', 'declined'])('posting on a %s proposal lands', async status => {
    await seed(status);
    const r = await post(`prop-${status}`, 'delivered, see the number');
    expect(r.status).toBe(201);
    expect(r.body.content).toBe('delivered, see the number');

    const read = await request(app)
      .get(`/api/proposals/prop-${status}/messages`)
      .set('X-Test-Agent-Id', 'agent-dt')
      .set('X-Workspace-Id', WS);
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
  });
});
