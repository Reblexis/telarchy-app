/**
 * Plan items: the owner's commitments that are not proposals
 * (docs/data-room.md, "What is planned"). Written by
 * POST/PUT /api/workspaces/:id/plans and listed by GET, all behind manage
 * (the cockpit's list; the public read is GET /api/data-room/planned); never deleted, only
 * done or edited, so nothing planned in public can be quietly unplanned. The
 * no-delete rule lives in the database (migration 0121), and the tests hit it
 * there, not only through the routes that are the convenient path to it.
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
  // Capabilities in a workspace OTHER than the header one: empty, which is
  // what makes the cross-workspace case a 403.
  computeCapabilities: async () => new Set<string>(),
}));

import { sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, permissionGroups, plans, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { workspacesRouter } from '../routes/workspaces';
import { buildActions } from '../services/actions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
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

/** The trigger's own message lives on Drizzle's cause chain; same helper as
 *  announcements.test.ts. */
async function refusal(op: Promise<unknown>): Promise<string> {
  try {
    await op;
  } catch (e) {
    let err: unknown = e,
      seen = '';
    while (err instanceof Error) {
      seen += ` ${err.message}`;
      err = (err as Error & { cause?: unknown }).cause;
    }
    return seen;
  }
  throw new Error('expected the plans table to refuse this, but it succeeded');
}

const WS = 'ws-plans';
const SLUG = 'plans-ws';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  auth = { workspaceId: WS, capabilities: new Set(['manage']), agentId: 'agent-p1' };
});

async function seed() {
  await db.insert(agents).values({ id: 'agent-p1', apiKeyHash: 'h-p1', balance: 0, nickname: 'owner' });
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Plans WS', createdBy: 'agent-p1', visibility: 'public', slug: SLUG });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-p',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
  });
}

const post = (body: object) => request(app).post(`/api/workspaces/${WS}/plans`).send(body);
const put = (id: string, body: object) => request(app).put(`/api/workspaces/${WS}/plans/${id}`).send(body);
const list = () => request(app).get(`/api/workspaces/${WS}/plans`);

describe('adding a plan', () => {
  test('201 with the row, dates as ISO strings, createdBy the caller', async () => {
    await seed();
    const res = await post({
      title: 'Write the September results post',
      description: 'Numbers from the data room, **bold** the headline.',
      start: '2026-09-15T09:00:00Z',
      due: '2026-09-20',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      workspaceId: WS,
      title: 'Write the September results post',
      description: 'Numbers from the data room, **bold** the headline.',
      start: '2026-09-15T09:00:00.000Z',
      due: '2026-09-20T00:00:00.000Z',
      doneAt: null,
      createdBy: 'agent-p1',
      createdAt: expect.stringMatching(ISO),
      editedAt: null,
    });
    const listed = await list();
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([res.body.id]);
  });

  test('a title alone is enough; start and due are optional', async () => {
    await seed();
    const res = await post({ title: 'Someday' });
    expect(res.status).toBe(201);
    expect(res.body.start).toBeNull();
    expect(res.body.due).toBeNull();
    expect(res.body.description).toBeNull();
  });

  test('title is required', async () => {
    await seed();
    expect((await post({})).status).toBe(400);
    expect((await post({ title: '   ' })).status).toBe(400);
    expect((await post({ title: 42 })).status).toBe(400);
    expect(await db.select().from(plans)).toHaveLength(0);
  });

  test('title over 200 characters is refused', async () => {
    await seed();
    expect((await post({ title: 'x'.repeat(200) })).status).toBe(201);
    expect((await post({ title: 'x'.repeat(201) })).status).toBe(400);
  });

  test('description over 5000 characters is refused', async () => {
    await seed();
    expect((await post({ title: 'ok', description: 'y'.repeat(5000) })).status).toBe(201);
    expect((await post({ title: 'ok', description: 'y'.repeat(5001) })).status).toBe(400);
  });

  test('an unparsable date is refused', async () => {
    await seed();
    expect((await post({ title: 'ok', start: 'next thursday' })).status).toBe(400);
    expect((await post({ title: 'ok', due: 'soon' })).status).toBe(400);
    expect((await post({ title: 'ok', due: 12345 })).status).toBe(400);
    expect(await db.select().from(plans)).toHaveLength(0);
  });

  test('due before start is refused', async () => {
    await seed();
    const res = await post({ title: 'ok', start: '2026-09-20T00:00:00Z', due: '2026-09-19T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/due/i);
    // Equal is fine: a point in time is a legitimate plan.
    expect((await post({ title: 'ok', start: '2026-09-20T00:00:00Z', due: '2026-09-20T00:00:00Z' })).status).toBe(201);
  });

  test('createdAt and doneAt are the server clock, never the body', async () => {
    await seed();
    const res = await post({
      title: 'ok',
      createdAt: '2020-01-01T00:00:00Z',
      doneAt: '2020-01-01T00:00:00Z',
      editedAt: '2020-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(new Date(res.body.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
    expect(res.body.doneAt).toBeNull();
    expect(res.body.editedAt).toBeNull();
  });
});

describe('editing a plan', () => {
  test('a field edit stamps editedAt and keeps createdAt', async () => {
    await seed();
    const created = await post({ title: 'Draft', due: '2026-09-20T00:00:00Z' });
    const res = await put(created.body.id, {
      title: 'Final',
      description: 'now with words',
      start: '2026-09-18T00:00:00Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Final');
    expect(res.body.description).toBe('now with words');
    expect(res.body.start).toBe('2026-09-18T00:00:00.000Z');
    expect(res.body.due).toBe('2026-09-20T00:00:00.000Z');
    expect(res.body.editedAt).toMatch(ISO);
    expect(res.body.createdAt).toBe(created.body.createdAt);
    expect(res.body.doneAt).toBeNull();
  });

  test('a date can be cleared with null', async () => {
    await seed();
    const created = await post({ title: 'Dated', start: '2026-09-18T00:00:00Z', due: '2026-09-20T00:00:00Z' });
    const res = await put(created.body.id, { due: null });
    expect(res.status).toBe(200);
    expect(res.body.due).toBeNull();
    expect(res.body.start).toBe('2026-09-18T00:00:00.000Z');
  });

  test('done: true stamps doneAt once; done: false clears it', async () => {
    await seed();
    const created = await post({ title: 'Do it' });
    const done = await put(created.body.id, { done: true });
    expect(done.status).toBe(200);
    expect(done.body.doneAt).toMatch(ISO);
    // Marking done is not an edit of the words.
    expect(done.body.editedAt).toBeNull();

    const again = await put(created.body.id, { done: true });
    expect(again.body.doneAt).toBe(done.body.doneAt);

    const undone = await put(created.body.id, { done: false });
    expect(undone.body.doneAt).toBeNull();

    const listed = await list();
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].done).toBe(false);
  });

  test('a done plan stays on the list, marked done, after the open ones', async () => {
    await seed();
    const open = await post({ title: 'Still open' });
    const created = await post({ title: 'Do it', due: '2026-09-20T00:00:00Z' });
    await put(created.body.id, { done: true });
    const listed = await list();
    expect(listed.body.items.map((i: { id: string; done: boolean }) => [i.id, i.done])).toEqual([
      [open.body.id, false],
      [created.body.id, true],
    ]);
  });

  test('editing the words does not move doneAt', async () => {
    await seed();
    const created = await post({ title: 'Do it' });
    const done = await put(created.body.id, { done: true });
    const edited = await put(created.body.id, { title: 'Did it' });
    expect(edited.body.doneAt).toBe(done.body.doneAt);
    expect(edited.body.createdAt).toBe(created.body.createdAt);
  });

  test('an empty body, a bad title, a bad date and due before start are 400', async () => {
    await seed();
    const created = await post({ title: 'Draft', start: '2026-09-18T00:00:00Z', due: '2026-09-20T00:00:00Z' });
    const id = created.body.id as string;
    expect((await put(id, {})).status).toBe(400);
    expect((await put(id, { title: '' })).status).toBe(400);
    expect((await put(id, { title: 'x'.repeat(201) })).status).toBe(400);
    expect((await put(id, { description: 'y'.repeat(5001) })).status).toBe(400);
    expect((await put(id, { due: 'whenever' })).status).toBe(400);
    expect((await put(id, { done: 'yes' })).status).toBe(400);
    // The rule holds against the STORED other end, not only within one body.
    expect((await put(id, { due: '2026-09-17T00:00:00Z' })).status).toBe(400);
    expect((await put(id, { start: '2026-09-21T00:00:00Z' })).status).toBe(400);
    const [row] = await db.select().from(plans);
    expect(row.title).toBe('Draft');
    expect(row.editedAt).toBeNull();
  });

  test('an unknown plan is 404', async () => {
    await seed();
    expect((await put('nope', { title: 'x' })).status).toBe(404);
  });
});

describe("listing a floor's plans (the cockpit's list)", () => {
  test('open entries first by due ascending with the undated last, then done by doneAt descending', async () => {
    await seed();
    const undated = await post({ title: 'Someday' });
    const late = await post({ title: 'Later', due: '2026-09-20T00:00:00Z' });
    const soon = await post({ title: 'Soon', due: '2026-09-12T00:00:00Z' });
    const doneFirst = await post({ title: 'Finished first' });
    const doneSecond = await post({ title: 'Finished second' });
    await put(doneFirst.body.id, { done: true });
    await new Promise(r => setTimeout(r, 5));
    await put(doneSecond.body.id, { done: true });
    const res = await list();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'now', 'workspace']);
    expect(res.body.workspace).toEqual({ id: WS, slug: SLUG, name: 'Plans WS' });
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      soon.body.id,
      late.body.id,
      undated.body.id,
      doneSecond.body.id,
      doneFirst.body.id,
    ]);
    expect(res.body.items[0]).toEqual({
      id: soon.body.id,
      title: 'Soon',
      description: null,
      start: null,
      due: '2026-09-12T00:00:00.000Z',
      done: false,
      createdAt: soon.body.createdAt,
      editedAt: null,
      doneAt: null,
    });
  });

  test('a floor with nothing planned lists nothing', async () => {
    await seed();
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  test("another floor's plans are not on the list", async () => {
    await seed();
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', createdBy: 'agent-p1', visibility: 'public', slug: 'other-ws' });
    await db.insert(plans).values({ id: 'pl-other', workspaceId: 'ws-other', title: 'Not ours' });
    await post({ title: 'Ours' });
    const res = await list();
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(['Ours']);
  });

  test('the list needs manage, like the writes: a reader is refused', async () => {
    await seed();
    await post({ title: 'secret-ish' });
    auth = { workspaceId: WS, capabilities: new Set(['read', 'trade']), agentId: 'agent-p1' };
    expect((await list()).status).toBe(403);
  });

  test('manage rights in one workspace do not list another', async () => {
    await seed();
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', createdBy: 'agent-p1', visibility: 'public', slug: 'other-ws' });
    expect((await request(app).get('/api/workspaces/ws-other/plans')).status).toBe(403);
  });

  test('an unknown workspace is 404', async () => {
    await seed();
    auth = { workspaceId: 'ws-none', capabilities: new Set(['manage']), agentId: 'agent-p1' };
    expect((await request(app).get('/api/workspaces/ws-none/plans')).status).toBe(404);
  });
});

describe('who may plan', () => {
  test('a caller without manage is refused', async () => {
    await seed();
    auth = { workspaceId: WS, capabilities: new Set(['read', 'trade']), agentId: 'agent-p1' };
    expect((await post({ title: 'mine?' })).status).toBe(403);
    expect((await put('any', { title: 'mine?' })).status).toBe(403);
    expect(await db.select().from(plans)).toHaveLength(0);
  });

  test('manage rights in one workspace do not reach another', async () => {
    await seed();
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', createdBy: 'agent-p1', visibility: 'public', slug: 'other-ws' });
    const cross = await request(app).post('/api/workspaces/ws-other/plans').send({ title: 'not mine' });
    expect(cross.status).toBe(403);
    expect(await db.select().from(plans)).toHaveLength(0);
  });

  test('an unknown workspace is 404', async () => {
    await seed();
    auth = { workspaceId: 'ws-none', capabilities: new Set(['manage']), agentId: 'agent-p1' };
    expect((await request(app).post('/api/workspaces/ws-none/plans').send({ title: 'x' })).status).toBe(404);
  });
});

describe('a plan is never deleted', () => {
  test('there is no delete route', async () => {
    await seed();
    const created = await post({ title: 'keep' });
    const gone = await request(app).delete(`/api/workspaces/${WS}/plans/${created.body.id}`);
    expect([404, 405]).toContain(gone.status);
    expect(await db.select().from(plans)).toHaveLength(1);
  });

  test('the database refuses a delete', async () => {
    await seed();
    await db.insert(plans).values({ id: 'pl-1', workspaceId: WS, title: 'keep' });
    expect(await refusal(db.execute(sql`DELETE FROM plans WHERE id = 'pl-1'`))).toMatch(/append-only|refused/i);
    expect(await db.select().from(plans)).toHaveLength(1);
  });
});

describe('the actions log', () => {
  test('added, edited and finished are three plan rows', async () => {
    await seed();
    const created = await post({ title: 'Call with Seer', due: '2026-09-17T14:00:00Z' });
    await put(created.body.id, { title: 'Call with Seer, Thursday' });
    await put(created.body.id, { done: true });
    const { rows } = await buildActions({ kinds: ['plan'], workspace: SLUG, limit: 50 });
    const id = created.body.id as string;
    expect(rows.map(r => r.id)).toEqual([`plan:${id}:done`, `plan:${id}:edit`, `plan:${id}`]);
    expect(rows.map(r => r.kind)).toEqual(['plan', 'plan', 'plan']);
    // The plans table keeps no original title (unlike announcements), so the
    // added row reads the words as they stand; the edit row says they changed.
    expect(rows[2].text).toBe('planned: Call with Seer, Thursday (due 2026-09-17)');
    expect(rows[1].text).toBe('edited a plan: Call with Seer, Thursday');
    expect(rows[0].text).toBe('finished a plan: Call with Seer, Thursday');
    for (const r of rows) {
      expect(r.actor).toEqual({ id: 'agent-p1', handle: 'owner' });
      expect(r.href).toBe(`/${SLUG}`);
    }
    expect(rows[2].detail).toMatchObject({ event: 'added', title: 'Call with Seer, Thursday' });
  });

  test('a plan with no due date is planned without one', async () => {
    await seed();
    await post({ title: 'Someday' });
    const { rows } = await buildActions({ kinds: ['plan'], workspace: SLUG, limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('planned: Someday');
  });
});
