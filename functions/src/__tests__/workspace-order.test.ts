/**
 * HTTP-level tests for the per-participant workspace display order:
 *   GET /api/workspaces          -> rows come back in the caller's saved order
 *   PUT /api/workspaces/order    -> persists that order (per identity)
 *
 * Ordering is a personal view preference keyed by the caller's identity, not a
 * workspace property, so it needs no manage capability and unsaved workspaces
 * sort after the ordered ones (oldest first).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: jest.fn(),
}));

jest.mock('../middleware/roles', () => ({
  requireIdentity: (req: any, res: any, next: any) => {
    if (!req.auth?.uid && !req.auth?.agentId && !req.auth?.isMasterKey) {
      return res.status(403).json({ error: 'Identity required' });
    }
    return next();
  },
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, workspaceOrderings, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { getAuthWorkspaceMemberships } from '../middleware/auth';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const membershipsMock = getAuthWorkspaceMemberships as jest.Mock;

// Auth identity is swapped per test via this holder before hitting the app.
let currentAuth: any = { uid: 'user-1', capabilities: new Set(['read', 'trade', 'manage']), workspaceId: '' };

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.auth = currentAuth;
  next();
});
app.use('/api/workspaces', workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const OWNER = 'owner-a';

function ws(id: string, name: string, minutesOld: number) {
  // Distinct createdAt so the unsaved-order tiebreak (oldest first) is deterministic.
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    createdBy: OWNER,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minutesOld)),
    visibility: 'private' as const,
  };
}

async function seedThree() {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-order', balance: toUnits(0) });
  await db.insert(workspaces).values([ws('ws-a', 'Alpha', 0), ws('ws-b', 'Bravo', 1), ws('ws-c', 'Charlie', 2)]);
  membershipsMock.mockResolvedValue([
    { workspaceId: 'ws-a', memberRole: 'admin' },
    { workspaceId: 'ws-b', memberRole: 'admin' },
    { workspaceId: 'ws-c', memberRole: 'admin' },
  ]);
}

const idsOf = (r: request.Response) => r.body.map((w: any) => w.id);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  membershipsMock.mockReset();
  currentAuth = { uid: 'user-1', capabilities: new Set(['read', 'trade', 'manage']), workspaceId: '' };
});

describe('PUT /api/workspaces/order + GET ordering', () => {
  test('default order (no saved rows) is oldest-first', async () => {
    await seedThree();
    const r = await request(app).get('/api/workspaces');
    expect(r.status).toBe(200);
    expect(idsOf(r)).toEqual(['ws-a', 'ws-b', 'ws-c']);
  });

  test('saved order is honored and persisted per identity', async () => {
    await seedThree();
    const put = await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-c', 'ws-a', 'ws-b'] });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ ok: true, order: ['ws-c', 'ws-a', 'ws-b'] });

    const rows = await db.select().from(workspaceOrderings);
    expect(rows.every(row => row.identity === 'user-1')).toBe(true);

    const r = await request(app).get('/api/workspaces');
    expect(idsOf(r)).toEqual(['ws-c', 'ws-a', 'ws-b']);
  });

  test('ids the caller does not belong to are dropped; unsaved workspace sorts last', async () => {
    await seedThree();
    // ws-d is a member but not in the saved list; ws-x is not a member at all.
    await db.insert(workspaces).values(ws('ws-d', 'Delta', 3));
    membershipsMock.mockResolvedValue([
      { workspaceId: 'ws-a', memberRole: 'admin' },
      { workspaceId: 'ws-b', memberRole: 'admin' },
      { workspaceId: 'ws-c', memberRole: 'admin' },
      { workspaceId: 'ws-d', memberRole: 'admin' },
    ]);
    const put = await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-x', 'ws-b', 'ws-b', 'ws-a'] });
    expect(put.status).toBe(200);
    expect(put.body.order).toEqual(['ws-b', 'ws-a']); // ws-x dropped, dupe collapsed

    const r = await request(app).get('/api/workspaces');
    // Saved (ws-b, ws-a) first, then unsaved ws-c and ws-d oldest-first.
    expect(idsOf(r)).toEqual(['ws-b', 'ws-a', 'ws-c', 'ws-d']);
  });

  test('order is per-identity: a different user is unaffected', async () => {
    await seedThree();
    await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-c', 'ws-b', 'ws-a'] });

    currentAuth = { uid: 'user-2', capabilities: new Set(['read']), workspaceId: '' };
    const r = await request(app).get('/api/workspaces');
    expect(idsOf(r)).toEqual(['ws-a', 'ws-b', 'ws-c']); // user-2 sees default order
  });

  test('reorder replaces prior order wholesale (stale positions cleared)', async () => {
    await seedThree();
    await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-c', 'ws-b', 'ws-a'] });
    await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-a'] });

    const rows = await db.select().from(workspaceOrderings);
    expect(rows.map(r => r.workspaceId)).toEqual(['ws-a']); // ws-b, ws-c rows gone

    const r = await request(app).get('/api/workspaces');
    expect(idsOf(r)).toEqual(['ws-a', 'ws-b', 'ws-c']); // ws-a saved, rest oldest-first
  });

  test('master key (no identity) cannot set a personal order', async () => {
    await seedThree();
    currentAuth = {
      isMasterKey: true,
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
      workspaceId: '',
    };
    const put = await request(app)
      .put('/api/workspaces/order')
      .send({ ids: ['ws-a'] });
    expect(put.status).toBe(403);
  });

  test('bad body is rejected', async () => {
    await seedThree();
    expect((await request(app).put('/api/workspaces/order').send({})).status).toBe(400);
    expect((await request(app).put('/api/workspaces/order').send({ ids: 'nope' })).status).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/workspaces/order')
          .send({ ids: [1, 2] })
      ).status,
    ).toBe(400);
  });
});
