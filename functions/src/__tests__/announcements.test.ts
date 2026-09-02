/**
 * Workspace announcements: the surface a charter's "if something material
 * happens that the market cannot see, I announce it" promise lands on
 * (docs/vision.md, "Workspace announcements").
 *
 * What is pinned here is the integrity, not the plumbing. An announcement is
 * only worth anything to a trader if the owner cannot quietly re-date it,
 * silently rewrite it, or make it disappear, so these tests are written
 * against the database, which is where those rules live (migration 0057), not
 * only against the routes that are the convenient path to them.
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
  // Capabilities in a workspace OTHER than the header one: the tests below
  // set this to empty, which is what makes the cross-workspace case a 403.
  computeCapabilities: async () => new Set<string>(),
}));

import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, announcements, permissionGroups, workspaces } from '../db/schema';
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

/** Drizzle wraps a driver error in "Failed query: ...", so the trigger's own
 *  message lives on the cause chain; asserting the top-level message would be
 *  asserting Drizzle's phrasing. Same helper as ledger-append-only.test.ts. */
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
  throw new Error('expected the announcement record to refuse this, but it succeeded');
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  auth = { workspaceId: WS, capabilities: new Set(['manage']), agentId: 'agent-a1' };
});

const WS = 'ws-ann';

async function seed(publicCaps: string[], visibility = 'public') {
  await db.insert(agents).values({ id: 'agent-a1', apiKeyHash: 'h-a1', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Announce WS',
    createdBy: 'agent-a1',
    visibility,
    slug: 'announce-ws',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-a',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
  });
}

describe('publishing', () => {
  test('an announcement reads back anonymously on the public floor', async () => {
    await seed(['read', 'trade']);
    const created = await request(app)
      .post(`/api/workspaces/${WS}/announcements`)
      .send({ body: 'The autumn Steam sale is locked in with Valve at 30% off, 29 Sep to 6 Oct.' });
    expect(created.status).toBe(201);
    expect(created.body.editedAt).toBeNull();
    expect(created.body.originalBody).toBeNull();

    const pub = await request(app).get(`/api/marketplace/announce-ws/announcements`);
    expect(pub.status).toBe(200);
    expect(pub.body.announcements).toHaveLength(1);
    expect(pub.body.announcements[0].body).toContain('30% off');
    expect(pub.body.announcements[0].id).toBe(created.body.id);
  });

  test('a delegate publisher is named on the row; the owner is not', async () => {
    // Owner decision 2026-08-25 ("dont publish under my name"): the first
    // automated publisher, results-agent, must never read as the owner.
    await seed(['read']);
    await db.insert(agents).values({ id: 'agent-pub', apiKeyHash: 'h-pub', balance: 0, nickname: 'results-agent' });
    const own = await request(app).post(`/api/workspaces/${WS}/announcements`).send({ body: 'The owner speaking.' });
    expect(own.status).toBe(201);
    expect(own.body.publishedBy).toBeNull();

    auth = { workspaceId: WS, capabilities: new Set(['manage']), agentId: 'agent-pub' };
    const delegated = await request(app)
      .post(`/api/workspaces/${WS}/announcements`)
      .send({ body: 'Week 35 results: 57 trades, one proposal paid.' });
    expect(delegated.status).toBe(201);
    expect(delegated.body.publishedBy).toBe('results-agent');

    const pub = await request(app).get(`/api/marketplace/announce-ws/announcements`);
    expect(pub.body.announcements.map((a: { publishedBy: string | null }) => a.publishedBy)).toEqual([
      'results-agent',
      null,
    ]);
    const floor = await request(app).get(`/api/marketplace/${WS}`);
    expect(floor.body.latestAnnouncement.publishedBy).toBe('results-agent');

    // The attribution is part of the record: nobody can later make the
    // delegate's words the owner's, or the other way round.
    const seen = await refusal(
      db.update(announcements).set({ publishedBy: null }).where(eq(announcements.id, delegated.body.id)),
    );
    expect(seen).toContain('published_by');
  });

  test('publishedAt is the server clock, not whatever the client sent', async () => {
    await seed(['read']);
    const backdated = new Date('2020-01-01T00:00:00Z').toISOString();
    const created = await request(app)
      .post(`/api/workspaces/${WS}/announcements`)
      .send({ body: 'material news', publishedAt: backdated, editedAt: backdated, originalBody: 'something else' });
    expect(created.status).toBe(201);
    // A disclosure timestamp the publisher picks proves nothing, so the route
    // must ignore the field entirely rather than validate it.
    expect(new Date(created.body.publishedAt).getUTCFullYear()).toBeGreaterThan(2020);
    expect(created.body.originalBody).toBeNull();
  });

  test('newest first, and an empty or oversized body is refused', async () => {
    await seed(['read']);
    await db.insert(announcements).values([
      { id: 'a-old', workspaceId: WS, body: 'first', publishedAt: new Date('2026-08-01T10:00:00Z') },
      { id: 'a-new', workspaceId: WS, body: 'second', publishedAt: new Date('2026-08-15T10:00:00Z') },
    ]);
    const pub = await request(app).get(`/api/marketplace/${WS}/announcements`);
    expect(pub.body.announcements.map((a: { id: string }) => a.id)).toEqual(['a-new', 'a-old']);

    const empty = await request(app).post(`/api/workspaces/${WS}/announcements`).send({ body: '   ' });
    expect(empty.status).toBe(400);
    const huge = await request(app)
      .post(`/api/workspaces/${WS}/announcements`)
      .send({ body: 'x'.repeat(5001) });
    expect(huge.status).toBe(400);
  });
});

describe('the privacy contract, the same one the ballot follows', () => {
  test('a private workspace 403s and a counts-only floor 403s', async () => {
    await seed(['read'], 'private');
    // Private resolves by id only (slug lookup excludes private), and answers
    // 403 the way GET /api/marketplace/:workspaceId already does.
    const priv = await request(app).get(`/api/marketplace/${WS}/announcements`);
    expect(priv.status).toBe(403);

    await truncateAll();
    await seed([]);
    const closed = await request(app).get(`/api/marketplace/${WS}/announcements`);
    expect(closed.status).toBe(403);
  });

  test('the workspace payload carries the latest one only inside the read gate', async () => {
    await seed(['read']);
    await db.insert(announcements).values({ id: 'a1', workspaceId: WS, body: 'latest news' });
    const open = await request(app).get(`/api/marketplace/${WS}`);
    expect(open.body.latestAnnouncement.body).toBe('latest news');
    expect(open.body.announcementCount).toBe(1);

    await db.update(permissionGroups).set({ capabilities: [] }).where(sql`id = 'grp-pub-a'`);
    const closed = await request(app).get(`/api/marketplace/${WS}`);
    expect(closed.body.latestAnnouncement).toBeUndefined();
    expect(closed.body.announcementCount).toBeUndefined();
  });
});

describe('editing keeps the record', () => {
  test('an edit preserves the original body and shows both timestamps publicly', async () => {
    await seed(['read']);
    const created = await request(app).post(`/api/workspaces/${WS}/announcements`).send({ body: 'Sale is 30% off.' });
    const id = created.body.id as string;

    const edited = await request(app)
      .put(`/api/workspaces/${WS}/announcements/${id}`)
      .send({ body: 'Correction: the sale is 25% off.' });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe('Correction: the sale is 25% off.');
    expect(edited.body.originalBody).toBe('Sale is 30% off.');
    expect(edited.body.editedAt).not.toBeNull();
    expect(edited.body.publishedAt).toBe(created.body.publishedAt);

    // A second edit does not overwrite the FIRST published text: the original
    // is what was there before anyone corrected anything.
    const again = await request(app)
      .put(`/api/workspaces/${WS}/announcements/${id}`)
      .send({ body: 'Correction 2: 20% off.' });
    expect(again.body.originalBody).toBe('Sale is 30% off.');

    const pub = await request(app).get(`/api/marketplace/${WS}/announcements`);
    const row = pub.body.announcements[0];
    expect(row.originalBody).toBe('Sale is 30% off.');
    expect(row.editedAt).not.toBeNull();
    expect(row.publishedAt).toBe(created.body.publishedAt);
  });

  test('saving an identical body is not an edit', async () => {
    await seed(['read']);
    const created = await request(app).post(`/api/workspaces/${WS}/announcements`).send({ body: 'same' });
    const same = await request(app)
      .put(`/api/workspaces/${WS}/announcements/${created.body.id}`)
      .send({ body: 'same' });
    expect(same.body.editedAt).toBeNull();
    expect(same.body.originalBody).toBeNull();
  });
});

describe('the owner cannot quietly change history', () => {
  test('the database refuses a delete, a re-date, and a body swap with no trace', async () => {
    await seed(['read']);
    await db.insert(announcements).values({ id: 'a1', workspaceId: WS, body: 'as published' });

    expect(await refusal(db.execute(sql`DELETE FROM announcements WHERE id = 'a1'`))).toMatch(/append-only/i);

    expect(
      await refusal(db.execute(sql`UPDATE announcements SET published_at = '2020-01-01' WHERE id = 'a1'`)),
    ).toMatch(/re-dated/i);

    // The exact operation the surface exists to prevent: swap the text,
    // leave no edit marker.
    expect(await refusal(db.execute(sql`UPDATE announcements SET body = 'never mind' WHERE id = 'a1'`))).toMatch(
      /edited_at/i,
    );

    // Marking it edited but pretending nothing preceded it is refused too.
    expect(
      await refusal(db.execute(sql`UPDATE announcements SET body = 'never mind', edited_at = now() WHERE id = 'a1'`)),
    ).toMatch(/original/i);

    // And the original, once recorded, is not editable either.
    await db.execute(
      sql`UPDATE announcements SET body = 'corrected', edited_at = now(), original_body = 'as published' WHERE id = 'a1'`,
    );
    expect(
      await refusal(db.execute(sql`UPDATE announcements SET original_body = 'a nicer version' WHERE id = 'a1'`)),
    ).toMatch(/not editable/i);

    const [row] = await db.select().from(announcements);
    expect(row.body).toBe('corrected');
    expect(row.originalBody).toBe('as published');
  });

  test('there is no delete route to reach for', async () => {
    await seed(['read']);
    await db.insert(announcements).values({ id: 'a1', workspaceId: WS, body: 'as published' });
    const gone = await request(app).delete(`/api/workspaces/${WS}/announcements/a1`);
    expect(gone.status).toBe(404);
    expect(await db.select().from(announcements)).toHaveLength(1);
  });
});

describe('who may publish', () => {
  test('manage rights in one workspace do not reach another', async () => {
    await seed(['read']);
    await db.insert(workspaces).values({
      id: 'ws-other',
      name: 'Other',
      createdBy: 'agent-a1',
      visibility: 'public',
      slug: 'other-ws',
    });
    // The gate passed against the header workspace; the handler acts on the
    // path id, where this identity holds nothing.
    const cross = await request(app)
      .post('/api/workspaces/ws-other/announcements')
      .send({ body: 'not mine to publish' });
    expect(cross.status).toBe(403);
    expect(await db.select().from(announcements)).toHaveLength(0);
  });

  test('a caller without manage is refused', async () => {
    await seed(['read']);
    auth = { workspaceId: WS, capabilities: new Set(['read', 'trade']), agentId: 'agent-a1' };
    const denied = await request(app).post(`/api/workspaces/${WS}/announcements`).send({ body: 'hello' });
    expect(denied.status).toBe(403);
  });
});
