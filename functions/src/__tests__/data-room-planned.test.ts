/**
 * The data room's "What is planned" read (docs/data-room.md, "What is
 * planned"): GET /api/data-room/planned answers anonymously with the
 * platform floor's calendar, the floor named by DATA_ROOM_WORKSPACE_SLUG
 * (default "telarchy"). The rules pinned here: the shape; the slug lookup is
 * case-insensitive and the env override is honoured; a fresh instance with
 * no such floor answers 200 with a null workspace rather than a 500; a
 * private floor with that slug is not disclosed; and the items are exactly
 * what the per-floor endpoint returns for the same floor, because the two
 * share one function and a bar drawn in the room must be the bar the floor
 * would draw.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, plans, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { dataRoomRouter } from '../routes/data-room';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/data-room', dataRoomRouter);
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const T = (s: string) => new Date(s);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  delete process.env.DATA_ROOM_WORKSPACE_SLUG;
});
afterAll(() => {
  delete process.env.DATA_ROOM_WORKSPACE_SLUG;
});

async function floor(opts: { id: string; slug: string; name?: string; visibility?: string; publicCaps?: string[] }) {
  const { id, slug, name = `Floor ${slug}`, visibility = 'public', publicCaps = ['read', 'trade'] } = opts;
  await db
    .insert(agents)
    .values({ id: `owner-${id}`, apiKeyHash: `h-${id}`, balance: 0, nickname: 'owner' })
    .onConflictDoNothing();
  await db.insert(workspaces).values({ id, name, createdBy: `owner-${id}`, visibility, slug });
  await db.insert(permissionGroups).values({
    id: `grp-pub-${id}`,
    workspaceId: id,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
  });
}

async function seedCommitments(wsId: string) {
  await db.insert(plans).values([
    { id: `${wsId}-pl-1`, workspaceId: wsId, title: 'Write the results post', due: T('2026-09-20T00:00:00.000Z') },
    { id: `${wsId}-pl-2`, workspaceId: wsId, title: 'Call with Seer', description: 'Thursday' },
  ]);
  await db.insert(proposals).values({
    id: `${wsId}-p-1`,
    number: 3,
    workspaceId: wsId,
    proposedBy: `owner-${wsId}`,
    title: 'Daily update for a week',
    status: 'pending',
    createdAt: T('2026-09-10T09:00:00.000Z'),
    decideBy: T('2026-09-12T09:00:00.000Z'),
  });
}

describe('GET /api/data-room/planned', () => {
  test('answers anonymously with the platform floor, the server clock and its items', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    await seedCommitments('ws-t');
    const before = Date.now();
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    const now = new Date(res.body.now).getTime();
    expect(now).toBeGreaterThanOrEqual(before - 1000);
    expect(now).toBeLessThanOrEqual(Date.now() + 1000);
    expect(res.body.items.map((i: { kind: string; id: string }) => [i.kind, i.id])).toEqual([
      ['decision', 'ws-t-p-1'],
      ['plan', 'ws-t-pl-1'],
      ['plan', 'ws-t-pl-2'],
    ]);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'now', 'workspace']);
  });

  test("the items are exactly what the floor's own timeline returns: one function, two doors", async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    await seedCommitments('ws-t');
    const room = await request(app).get('/api/data-room/planned');
    const floorRead = await request(app).get('/api/marketplace/telarchy/timeline');
    expect(floorRead.status).toBe(200);
    expect(room.body.items).toEqual(floorRead.body.items);
    expect(room.body.items.length).toBeGreaterThan(0);
  });

  test('the slug is looked up case-insensitively', async () => {
    await floor({ id: 'ws-t', slug: 'Telarchy', name: 'Telarchy' });
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-t', slug: 'Telarchy', name: 'Telarchy' });
  });

  test('DATA_ROOM_WORKSPACE_SLUG names a different floor', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    await floor({ id: 'ws-s', slug: 'snake', name: 'Snake' });
    await seedCommitments('ws-s');
    process.env.DATA_ROOM_WORKSPACE_SLUG = 'snake';
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-s', slug: 'snake', name: 'Snake' });
    expect(res.body.items).toHaveLength(3);
  });

  test('a fresh instance with no such floor answers 200 with a null workspace, never a 500', async () => {
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toBeNull();
    expect(res.body.items).toEqual([]);
    expect(typeof res.body.now).toBe('string');
  });

  test('a private floor with that slug is not disclosed: null workspace, no items', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', visibility: 'private' });
    await seedCommitments('ws-t');
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toBeNull();
    expect(res.body.items).toEqual([]);
  });

  test('THE ROOM IS PUBLIC, SO ONLY A PUBLIC FLOOR IS ITS CALENDAR: an unlisted floor answers null', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy', visibility: 'unlisted' });
    await seedCommitments('ws-t');
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toBeNull();
    expect(res.body.items).toEqual([]);
  });

  test('a floor with nothing planned answers the floor and an empty list', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    const res = await request(app).get('/api/data-room/planned');
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    expect(res.body.items).toEqual([]);
  });
});
