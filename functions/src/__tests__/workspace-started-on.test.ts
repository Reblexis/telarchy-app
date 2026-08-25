/**
 * `telarchyStartedOn`: the one moment the floor's year chart marks.
 *
 * It is owner-declared rather than derived, so the two things worth pinning
 * are that it round-trips to the public payload (the chart reads it from
 * there) and that an unparseable date is refused rather than stored as an
 * Invalid Date, which would reach the frontend as null and silently drop the
 * marker the owner thought they had set.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

let auth: { workspaceId: string; capabilities: Set<string>; uid?: string; agentId?: string; isMasterKey?: boolean };

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

jest.mock('../middleware/roles', () => ({
  requireCapability: (cap: string) => (req: any, res: any, next: any) => {
    if (!req.auth?.capabilities?.has(cap)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  },
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../middleware/capabilities', () => ({
  computeCapabilities: async () => new Set<string>(['manage']),
}));

import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use(
  '/api/workspaces',
  (req: any, _res, next) => {
    req.auth = auth;
    next();
  },
  workspacesRouter,
);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-started';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  auth = { workspaceId: WS, capabilities: new Set(['manage', 'manage_workspace']), agentId: 'agent-s1' };
  await db.insert(agents).values({ id: 'agent-s1', apiKeyHash: 'h-s1', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Started WS',
    createdBy: 'agent-s1',
    visibility: 'public',
    slug: 'started-ws',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-s',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read'],
    memberIds: [],
  });
});

describe('the year chart marker date', () => {
  test('round-trips to the public payload, and clears back to null', async () => {
    const set = await request(app)
      .put(`/api/workspaces/${WS}/settings`)
      .send({ telarchyStartedOn: '2026-08-13T00:00:00.000Z' });
    expect(set.status).toBe(200);

    const pub = await request(app).get(`/api/marketplace/${WS}`);
    expect(pub.body.telarchyStartedOn).toBe('2026-08-13T00:00:00.000Z');

    await request(app).put(`/api/workspaces/${WS}/settings`).send({ telarchyStartedOn: null });
    expect((await request(app).get(`/api/marketplace/${WS}`)).body.telarchyStartedOn).toBeNull();
  });

  test('an unparseable date is refused, not stored as an Invalid Date', async () => {
    const bad = await request(app)
      .put(`/api/workspaces/${WS}/settings`)
      .send({ telarchyStartedOn: 'sometime in August' });
    expect(bad.status).toBe(400);
    expect((await request(app).get(`/api/marketplace/${WS}`)).body.telarchyStartedOn).toBeNull();
  });

  test('a workspace that never set one reports null, not a missing field', async () => {
    // Missing and null are different to a chart: null is "no marker", while a
    // missing key reads as "the caller is not allowed to see", which is what
    // the read gate means everywhere else on this payload.
    const pub = await request(app).get(`/api/marketplace/${WS}`);
    expect(pub.body).toHaveProperty('telarchyStartedOn');
    expect(pub.body.telarchyStartedOn).toBeNull();
  });
});
