/**
 * Trader-first sequencing (vision.md, owner decision 2026-08-08): workspace
 * creation is waitlisted until trader demand is proven. POST /api/workspaces
 * is platform-admin/master-key only, and the refusal must carry the waitlist
 * pointer, because the 403 IS the owner side's signpost for API callers.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      isMasterKey: req.headers['x-test-master'] === '1',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import express from 'express';
import { db, ensureMigrations, truncateAll } from './harness/test-db';
import { agents } from '../db/schema';
import { workspacesRouter } from '../routes/workspaces';
import { authMiddleware } from '../middleware/auth';
import { AppError } from '../lib/errors';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/workspaces', workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

function create(headers: Record<string, string>) {
  return request(app).post('/api/workspaces')
    .set(headers)
    .send({ name: 'Gate Test WS' });
}

describe('workspace creation gate (trader-first)', () => {
  test('a plain trader is refused with the waitlist pointer', async () => {
    await db.insert(agents).values({ id: 'plain-trader', apiKeyHash: 'h-pt', balance: 0 });

    const res = await create({ 'X-Test-Agent-Id': 'plain-trader' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invite-only/);
    expect(res.body.waitlist).toBe('https://telarchy.com/manage');
  });

  test('a platform admin can still create', async () => {
    await db.insert(agents).values({ id: 'the-admin', apiKeyHash: 'h-adm', balance: 0, platformAdmin: true });

    const res = await create({ 'X-Test-Agent-Id': 'the-admin' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Gate Test WS');
  });

  test('the master key can still create', async () => {
    const res = await create({ 'X-Test-Master': '1' });
    expect(res.status).toBe(201);
  });
});

describe('onboard gate (trader-first)', () => {
  test('POST /api/onboard is paused with the waitlist pointer', async () => {
    // OWNER_ONBOARDING_OPEN is unset in this file's module registry, so the
    // route loads with the gate closed, exactly as in production.
    const { onboardRouter } = require('../routes/onboard');
    const onboardApp = express();
    onboardApp.use(express.json());
    onboardApp.use('/api/onboard', onboardRouter);

    const res = await request(onboardApp).post('/api/onboard')
      .send({ workspace: { name: 'X' } });

    expect(res.status).toBe(403);
    expect(res.body.waitlist).toBe('https://telarchy.com/manage');
  });
});
