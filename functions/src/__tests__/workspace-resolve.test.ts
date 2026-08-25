/**
 * HTTP-level tests for GitHub-style workspace URL resolution:
 *   GET  /api/workspaces/resolve?owner=&slug=   (path -> workspace id)
 *   PUT  /api/workspaces/:id/settings (rename regenerates slug, old slug kept)
 *
 * Owner segment resolves by raw agent id OR custom id (nickname). Renaming a
 * workspace mints a new slug while the old one keeps resolving with moved=true
 * so existing links 301-redirect.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

jest.mock('../middleware/roles', () => ({
  requireIdentity: (_req: any, _res: any, next: any) => next(),
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.auth = {
    isMasterKey: true,
    capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    workspaceId: '',
  };
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

const OWNER = 'agent-owner-ws';
const WS = 'ws-resolve-test';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(nickname?: string) {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-ws-resolve', balance: toUnits(0), nickname });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Q3 Growth',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'private',
  });
}

describe('GET /api/workspaces/resolve', () => {
  test('resolves owner-by-nickname + current slug, moved=false', async () => {
    await seed('acme-corp');
    const r = await request(app).get('/api/workspaces/resolve').query({ owner: 'acme-corp', slug: 'q3-growth' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      workspaceId: WS,
      canonicalOwner: 'acme-corp',
      canonicalSlug: 'q3-growth',
      moved: false,
    });
  });

  test('resolves owner-by-raw-id when no nickname is set', async () => {
    await seed();
    const r = await request(app).get('/api/workspaces/resolve').query({ owner: OWNER, slug: 'q3-growth' });
    expect(r.status).toBe(200);
    expect(r.body.workspaceId).toBe(WS);
    expect(r.body.canonicalOwner).toBe(OWNER); // falls back to id
  });

  test('owner match is case-insensitive on nickname', async () => {
    await seed('Acme-Corp');
    const r = await request(app).get('/api/workspaces/resolve').query({ owner: 'acme-corp', slug: 'q3-growth' });
    expect(r.status).toBe(200);
    expect(r.body.workspaceId).toBe(WS);
  });

  test('404 for unknown owner and unknown slug', async () => {
    await seed('acme-corp');
    expect(
      (await request(app).get('/api/workspaces/resolve').query({ owner: 'nobody', slug: 'q3-growth' })).status,
    ).toBe(404);
    expect((await request(app).get('/api/workspaces/resolve').query({ owner: 'acme-corp', slug: 'nope' })).status).toBe(
      404,
    );
  });
});

describe('rename regenerates slug and keeps the old one resolving', () => {
  test('PUT settings name -> new slug; old slug resolves with moved=true', async () => {
    await seed('acme-corp');

    const put = await request(app).put(`/api/workspaces/${WS}/settings`).send({ name: 'Q4 Growth' });
    expect(put.status).toBe(200);
    expect(put.body.slug).toBe('q4-growth');

    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, WS));
    expect(row.slug).toBe('q4-growth');

    // New slug is canonical.
    const fresh = await request(app).get('/api/workspaces/resolve').query({ owner: 'acme-corp', slug: 'q4-growth' });
    expect(fresh.body).toMatchObject({ workspaceId: WS, moved: false });

    // Old slug still resolves but is flagged stale, pointing at the new canonical slug.
    const old = await request(app).get('/api/workspaces/resolve').query({ owner: 'acme-corp', slug: 'q3-growth' });
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({ workspaceId: WS, canonicalSlug: 'q4-growth', moved: true });
  });
});
