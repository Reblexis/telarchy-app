/**
 * Reading a public market needs no key. Acting always does.
 *
 * Owner direction 2026-08-20: "only placing trades or writing comments should
 * require api key... you know the user action stuff". Before this, an agent
 * had to register before it could see what was being traded, while the same
 * numbers were already open under /api/marketplace/*: two doors to one fact,
 * one of them locked.
 *
 * The line these tests hold is the whole design:
 *
 *   public workspace + read      → yes, anonymously
 *   public workspace + anything else → no, identity required
 *   private workspace + anything → no
 *
 * Note the second line survives even when the workspace's Public group grants
 * `trade`, which an Open workspace does so that a self-join makes you a
 * trader. Without an identity there is no account to debit and no author to
 * attach to a comment.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, metrics, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { anonymousCapabilities, resolvePublicReadWorkspace } from '../lib/public-read';
import { toUnits } from '../lib/validation';
import { requireCapability, requireIdentity } from '../middleware/roles';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const OPEN_WS = 'ws-open';
const PRIVATE_WS = 'ws-private';
const OWNER = 'agent-owner';

/**
 * A miniature of the real stack: the anonymous branch of the auth middleware,
 * then the same guards the routes use. The middleware itself cannot be
 * imported here (it pulls better-auth's ESM build, which jest's CJS loader
 * refuses), which is exactly why the rule lives in lib/public-read.ts.
 */
const app = express();
app.use(express.json());
app.use('/api', async (req, _res, next) => {
  const named =
    (req.headers['x-workspace-id'] as string | undefined) ??
    (typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined);
  if (named) {
    const resolved = await resolvePublicReadWorkspace(named);
    if (resolved) req.auth = { capabilities: anonymousCapabilities(), workspaceId: resolved };
  }
  next();
});
app.get('/api/read-thing', requireCapability('read'), (req, res) => {
  res.json({ ok: true, workspaceId: req.auth?.workspaceId, anonymous: !req.auth?.agentId && !req.auth?.uid });
});
app.post('/api/trade-thing', requireCapability('trade'), (_req, res) => res.json({ ok: true }));
app.get('/api/member-thing', requireIdentity, requireCapability('read'), (_req, res) => res.json({ ok: true }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: OPEN_WS,
    name: 'Open floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: PRIVATE_WS,
    name: 'Private',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
  await db.update(workspaces).set({ slug: 'open-floor' }).where(eq(workspaces.id, OPEN_WS));
  await db.insert(metrics).values({
    id: 'm-1',
    workspaceId: OPEN_WS,
    name: 'Revenue',
    value: 10,
    formula: '0',
    marketRangeMax: 100,
  });
  // An Open floor: the Public group grants read AND trade, which is what makes
  // a self-join enough to trade. The anonymous grant must still be read only.
  const [pub] = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, OPEN_WS));
  void pub;
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.workspaceId, OPEN_WS));
});

const get = (path: string, ws?: string) => {
  const r = request(app).get(path);
  return ws ? r.set('X-Workspace-Id', ws) : r;
};

describe('an anonymous caller on an open workspace', () => {
  test('can read', async () => {
    const res = await get('/api/read-thing', OPEN_WS);
    expect(res.status).toBe(200);
    expect(res.body.anonymous).toBe(true);
    expect(res.body.workspaceId).toBe(OPEN_WS);
  });

  test('can name the workspace by slug, which is all it has from a link', async () => {
    const res = await get('/api/read-thing', 'open-floor');
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(OPEN_WS);
  });

  test('cannot trade, even though the Public group grants trade', async () => {
    const res = await request(app).post('/api/trade-thing').set('X-Workspace-Id', OPEN_WS).send({});
    expect(res.status).toBe(403);
  });

  test('cannot read workspace internals, which need an identity', async () => {
    const res = await get('/api/member-thing', OPEN_WS);
    expect(res.status).toBe(403);
  });
});

describe('an anonymous caller elsewhere', () => {
  test('gets nothing on a private workspace', async () => {
    expect((await get('/api/read-thing', PRIVATE_WS)).status).toBe(401);
  });

  test('gets nothing when it names no workspace', async () => {
    expect((await get('/api/read-thing')).status).toBe(401);
  });

  test('gets nothing for a workspace that does not exist', async () => {
    expect((await get('/api/read-thing', 'no-such-workspace')).status).toBe(401);
  });

  test('gets nothing once the owner closes the Public group', async () => {
    await db.update(permissionGroups).set({ capabilities: [] }).where(eq(permissionGroups.workspaceId, OPEN_WS));
    expect((await get('/api/read-thing', OPEN_WS)).status).toBe(401);
  });
});
