/**
 * Hiding a floor from the public actions log is a platform admin's call
 * (docs/data-room.md, "An automated floor is hidden by default"). The
 * log's promise is that every public action is on it; an owner taking their
 * own floor off it would break that promise for everyone else, so the
 * owner's manage right is not enough.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      isMasterKey: req.headers['x-test-master'] === '1',
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/workspaces', workspacesRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-snake';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'owner', apiKeyHash: 'h-owner', balance: 0 },
    { id: 'admin', apiKeyHash: 'h-admin', balance: 0, platformAdmin: true },
  ]);
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Snake', slug: 'snake', createdBy: 'owner', visibility: 'public' });
  await db.insert(permissionGroups).values([
    {
      id: 'pg-owner',
      workspaceId: WS,
      name: 'Owners',
      type: 'owner',
      memberIds: ['owner', 'admin'],
      capabilities: ['read', 'trade', 'manage', 'manage_workspace'],
    },
  ]);
});

async function hidden(): Promise<boolean> {
  const [ws] = await db.select({ h: workspaces.logHidden }).from(workspaces).where(eq(workspaces.id, WS));
  return ws.h;
}

const put = (who: string, body: unknown) =>
  request(app).put(`/api/workspaces/${WS}/settings`).set('X-Test-Agent-Id', who).set('X-Workspace-Id', WS).send(body);

describe('logHidden on the settings route', () => {
  it('is false by default', async () => {
    expect(await hidden()).toBe(false);
  });

  it('the owner alone cannot hide their floor from the log', async () => {
    const res = await put('owner', { logHidden: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/platform admin/);
    expect(await hidden()).toBe(false);
  });

  it('a platform admin can, and can put it back', async () => {
    expect((await put('admin', { logHidden: true })).status).toBe(200);
    expect(await hidden()).toBe(true);
    expect((await put('admin', { logHidden: false })).status).toBe(200);
    expect(await hidden()).toBe(false);
  });

  it('the master key can', async () => {
    const res = await request(app)
      .put(`/api/workspaces/${WS}/settings`)
      .set('X-Test-Master', '1')
      .set('X-Workspace-Id', WS)
      .send({ logHidden: true });
    expect(res.status).toBe(200);
    expect(await hidden()).toBe(true);
  });

  it('refuses anything but a boolean', async () => {
    const res = await put('admin', { logHidden: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/logHidden/);
    expect(await hidden()).toBe(false);
  });

  it('a settings edit that does not name it leaves it alone', async () => {
    await db.update(workspaces).set({ logHidden: true }).where(eq(workspaces.id, WS));
    expect((await put('owner', { description: 'A snake.' })).status).toBe(200);
    expect(await hidden()).toBe(true);
  });
});
