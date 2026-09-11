/**
 * The data room's "What is planned" read (docs/data-room.md, "What is
 * planned"): GET /api/data-room/planned answers anonymously with the
 * platform floor's calendar, the floor named by DATA_ROOM_WORKSPACE_SLUG
 * (default "telarchy"). The rules pinned here: the shape; the slug lookup is
 * case-insensitive and the env override is honoured; a fresh instance with
 * no such floor answers 200 with a null workspace rather than a 500; a
 * private floor with that slug is not disclosed; and the items are the plan
 * entries the owner typed, open first by due then done by doneAt, and never
 * anything derived from the proposals or the books (docs/data-room.md, rule
 * 5: "The planned tab holds what the owner typed and nothing derived").
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
import { agents, markets, metrics, permissionGroups, plans, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { dataRoomRouter } from '../routes/data-room';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/data-room', dataRoomRouter);
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
    {
      id: `${wsId}-pl-1`,
      workspaceId: wsId,
      title: 'Write the results post',
      due: T('2026-09-20T00:00:00.000Z'),
      createdAt: T('2026-09-01T00:00:00.000Z'),
    },
    {
      id: `${wsId}-pl-2`,
      workspaceId: wsId,
      title: 'Call with Seer',
      description: 'Thursday',
      createdAt: T('2026-09-01T00:00:00.000Z'),
    },
    {
      id: `${wsId}-pl-3`,
      workspaceId: wsId,
      title: 'Already finished',
      due: T('2026-09-05T00:00:00.000Z'),
      doneAt: T('2026-09-04T00:00:00.000Z'),
      createdAt: T('2026-09-01T00:00:00.000Z'),
    },
  ]);
}

/** A floor with everything the old axis used to derive a bar from: an
 *  approved proposal with a live book, a pending proposal with a deadline,
 *  and an open baseline book. None of it may reach the planned tab. */
async function seedDerivables(wsId: string) {
  await db.insert(metrics).values({ id: `${wsId}-met`, workspaceId: wsId, name: 'Active forecasters' });
  await db.insert(proposals).values([
    {
      id: `${wsId}-p-approved`,
      number: 2,
      workspaceId: wsId,
      proposedBy: `owner-${wsId}`,
      title: 'Approved, not delivered',
      status: 'approved',
      createdAt: T('2026-09-01T09:00:00.000Z'),
      resolvedAt: T('2026-09-02T09:00:00.000Z'),
    },
    {
      id: `${wsId}-p-pending`,
      number: 3,
      workspaceId: wsId,
      proposedBy: `owner-${wsId}`,
      title: 'Daily update for a week',
      status: 'pending',
      createdAt: T('2026-09-10T09:00:00.000Z'),
      decideBy: T('2026-09-12T09:00:00.000Z'),
    },
  ]);
  const book = (id: string, over: Partial<typeof markets.$inferInsert>) => ({
    id,
    workspaceId: wsId,
    metricId: `${wsId}-met`,
    metricName: 'Active forecasters',
    targetDate: '2026-10',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: 10,
    settlesAt: T('2026-11-01T00:00:00.000Z'),
    ...over,
  });
  await db
    .insert(markets)
    .values([
      book(`${wsId}-m-approved`, { proposalId: `${wsId}-p-approved`, branch: 'approved' }),
      book(`${wsId}-m-baseline`, {}),
    ]);
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
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['ws-t-pl-1', 'ws-t-pl-2', 'ws-t-pl-3']);
    expect(res.body.items[0]).toEqual({
      id: 'ws-t-pl-1',
      title: 'Write the results post',
      description: null,
      start: null,
      due: '2026-09-20T00:00:00.000Z',
      done: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      editedAt: null,
      doneAt: null,
    });
    expect(Object.keys(res.body).sort()).toEqual(['items', 'now', 'workspace']);
  });

  test('THE PLANNED TAB HOLDS WHAT THE OWNER TYPED AND NOTHING DERIVED', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    await seedDerivables('ws-t');
    const empty = await request(app).get('/api/data-room/planned');
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    await seedCommitments('ws-t');
    const res = await request(app).get('/api/data-room/planned');
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['ws-t-pl-1', 'ws-t-pl-2', 'ws-t-pl-3']);
    const printed = JSON.stringify(res.body.items);
    expect(printed).not.toContain('Daily update for a week');
    expect(printed).not.toContain('Approved, not delivered');
    expect(printed).not.toContain('Active forecasters');
    for (const it of res.body.items) {
      expect(it).not.toHaveProperty('kind');
      expect(it).not.toHaveProperty('href');
    }
  });

  test('open entries come first by due, the undated after them, then the done ones by doneAt descending', async () => {
    await floor({ id: 'ws-t', slug: 'telarchy', name: 'Telarchy' });
    await seedCommitments('ws-t');
    await db.insert(plans).values([
      {
        id: 'ws-t-pl-4',
        workspaceId: 'ws-t',
        title: 'Finished later',
        doneAt: T('2026-09-09T00:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'ws-t-pl-5',
        workspaceId: 'ws-t',
        title: 'Sooner',
        due: T('2026-09-15T00:00:00.000Z'),
        createdAt: T('2026-09-01T00:00:00.000Z'),
      },
    ]);
    const res = await request(app).get('/api/data-room/planned');
    expect(res.body.items.map((i: { id: string; done: boolean }) => `${i.id}:${i.done ? 'done' : 'open'}`)).toEqual([
      'ws-t-pl-5:open',
      'ws-t-pl-1:open',
      'ws-t-pl-2:open',
      'ws-t-pl-4:done',
      'ws-t-pl-3:done',
    ]);
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
