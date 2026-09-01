/**
 * HTTP-level tests for the participant bio: a freeform public description
 * (max 500 chars) on the agents table.
 *
 *  - POST /api/agents/register accepts an optional bio and stores it
 *  - POST /api/auth/profile sets, updates, and clears it (works for agent keys)
 *  - GET /api/agents/:idOrNickname/public exposes it
 *  - validation: non-string and >500-char bios are rejected with 400
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
    getUserWorkspaceMemberships: async () => [],
  };
});

jest.mock('../middleware/roles', () => ({
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireSelfOrAdmin: (_req: any, _res: any, next: any) => next(),
  requireSelfOrOwner: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, workspaces } from '../db/schema';
import { MAX_BIO_LENGTH, normalizeBio } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { userauthRouter } from '../routes/userauth';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-bio';
const AGENT = 'bio-bot';

function makeApp(agentId: string | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = agentId ? { agentId, workspaceId: WS, capabilities: new Set(['read', 'trade', 'manage']) } : undefined;
    next();
  });
  app.use('/api/agents', agentsRouter);
  app.use('/api/auth', userauthRouter);
  return app;
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  // 'public': the fixture wants a floor anyone can self-register into.
  // It said 'open', which is not one of the three visibilities and only
  // ever worked because the old gate asked "is this private?" instead of
  // "is this public?". The column is unconstrained text, so an unknown
  // value is now treated as restricted, which is the safe direction.
  await db.insert(workspaces).values({ id: WS, name: 'Bio Test', createdBy: 'owner', visibility: 'public' });
});

describe('normalizeBio', () => {
  test('trims, clears on empty/null, rejects non-strings and over-length', () => {
    expect(normalizeBio('  hello  ')).toBe('hello');
    expect(normalizeBio('')).toBeNull();
    expect(normalizeBio('   ')).toBeNull();
    expect(normalizeBio(null)).toBeNull();
    expect(normalizeBio(42)).toBeInstanceOf(Error);
    expect(normalizeBio('x'.repeat(MAX_BIO_LENGTH))).toBe('x'.repeat(MAX_BIO_LENGTH));
    expect(normalizeBio('x'.repeat(MAX_BIO_LENGTH + 1))).toBeInstanceOf(Error);
  });
});

describe('participant bio over HTTP', () => {
  test('register stores the bio and returns it; public profile exposes it', async () => {
    const app = makeApp(null);
    const reg = await request(app)
      .post('/api/agents/register')
      .send({ agentId: AGENT, workspaceId: WS, bio: '  Momentum trader for revenue metrics.  ' });
    expect(reg.status).toBe(201);
    expect(reg.body.bio).toBe('Momentum trader for revenue metrics.');

    const pub = await request(app).get(`/api/agents/${AGENT}/public`);
    expect(pub.status).toBe(200);
    expect(pub.body.bio).toBe('Momentum trader for revenue metrics.');
  });

  test('register rejects an over-length bio', async () => {
    const app = makeApp(null);
    const reg = await request(app)
      .post('/api/agents/register')
      .send({ agentId: AGENT, workspaceId: WS, bio: 'x'.repeat(501) });
    expect(reg.status).toBe(400);
    expect(reg.body.error).toMatch(/500/);
  });

  test('profile endpoint sets, updates, and clears the bio for an agent-key caller', async () => {
    const anon = makeApp(null);
    await request(anon).post('/api/agents/register').send({ agentId: AGENT, workspaceId: WS });

    const app = makeApp(AGENT);
    const set = await request(app).post('/api/auth/profile').send({ bio: 'Here to forecast NPS.' });
    expect(set.status).toBe(200);
    let [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.bio).toBe('Here to forecast NPS.');

    await request(app).post('/api/auth/profile').send({ bio: 'Updated purpose.' });
    [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.bio).toBe('Updated purpose.');

    // Empty string clears.
    await request(app).post('/api/auth/profile').send({ bio: '' });
    [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.bio).toBeNull();
  });

  test('profile endpoint validates the bio', async () => {
    const anon = makeApp(null);
    await request(anon).post('/api/agents/register').send({ agentId: AGENT, workspaceId: WS });

    const app = makeApp(AGENT);
    const bad = await request(app).post('/api/auth/profile').send({ bio: 42 });
    expect(bad.status).toBe(400);
    const long = await request(app)
      .post('/api/auth/profile')
      .send({ bio: 'x'.repeat(501) });
    expect(long.status).toBe(400);
    // A bad bio must not clobber other fields silently.
    const [row] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(row.bio).toBeNull();
  });
});
