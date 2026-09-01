/**
 * Every provider is reached at `/api/import/:provider`, and no provider has
 * a mount of its own (docs/record-links.md, "One router serves every
 * provider").
 *
 * The bug this file exists to stop: `app.use('/api/import/manifold',
 * manifoldRouter)` was registered ABOVE the generic
 * `app.use('/api/import', recordLinkRouter)`, so Express handed every
 * Manifold request to the old route, which read `req.body.username` while
 * the dialog had moved to `{ handle }`. Manifold linking answered
 * "username must be your Manifold handle" for every handle in the world,
 * live, from 2026-08-31 until 2026-09-01, and no Manifold record was
 * linked in that window. Polymarket, which had no mount of its own, worked
 * the whole time.
 *
 * It survived a green suite because record-links.test.ts mounts the
 * generic router BY ITSELF, where nothing can shadow it. So these tests
 * drive the real `app` from app.ts: mount order is the thing under test,
 * and only the real app has one.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-record-link-mount';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'record-link-mount-secret-abcdefgh';
process.env.REGISTRATION_LIMIT_MAX = '10000';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { app } from '../app';
import { agentApiKeys, agents, earnRules, systemConfig } from '../db/schema';
import { toUnits } from '../lib/validation';
import { clearEarnRuleCache } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const AGENT = 'rl-mount-agent';
const KEY = 'rl-mount-agent-key';
const WS = 'rl-mount-ws';
const DAY = 86_400_000;

// The Manifold account under test, controllable per test.
let mfBio = '';
let mfCreated = Date.now() - 400 * DAY;
let mfLastBet = Date.now() - 2 * DAY;
let mfIsBot = false;

const realFetch = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h-rl-mount', balance: toUnits(0) });
  await db.insert(agentApiKeys).values({
    hash: createHash('sha256').update(KEY).digest('hex'),
    keyId: 'rl-mount-key-id',
    agentId: AGENT,
    workspaceId: WS,
  });
  await db.insert(earnRules).values({
    key: 'manifold_link',
    label: 'Link a Manifold record',
    credits: 5000,
    kind: 'flat',
    note: '',
  });
  clearEarnRuleCache();

  mfBio = '';
  mfCreated = Date.now() - 400 * DAY;
  mfLastBet = Date.now() - 2 * DAY;
  mfIsBot = false;

  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('api.manifold.markets')) {
      if (u.includes('/user/nobody-here')) return new Response('null', { status: 404 });
      return new Response(
        JSON.stringify({
          id: 'mf-user-id-1',
          username: 'Viktor36',
          bio: mfBio,
          createdTime: mfCreated,
          lastBetTime: mfLastBet,
          isBot: mfIsBot,
          creatorTraders: { allTime: 12 },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(path).set('Origin', 'http://localhost').set('X-Agent-Key', KEY).send(body);

describe('the path every provider is linked at', () => {
  test('THE RULE: /api/import/manifold/start takes { handle }, like every other provider', async () => {
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.body.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^telarchy-[0-9a-f]{8}$/);
    expect(res.body.handle).toBe('Viktor36');
    expect(res.body.proofField).toBe('bio');
  });

  test('the reply names the field to edit, so the dialog can say where the code goes', async () => {
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.body.proofField).toBe('bio');
  });

  test('{ username }, what an older client sends, is still accepted', async () => {
    // A cached bundle keeps posting the old key for as long as a browser
    // holds it. Refusing it would repeat the outage on the next deploy.
    const res = await post('/api/import/manifold/start', { username: 'Viktor36' });
    expect(res.status).toBe(200);
    expect(res.body.handle).toBe('Viktor36');
  });

  test('a handle that is not a handle is refused, naming the handle', async () => {
    const res = await post('/api/import/manifold/start', { handle: 'https://manifold.markets/Viktor36' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/handle/i);
  });

  test('an unknown provider is a 404 that names it, not a 404 from a missing mount', async () => {
    const res = await post('/api/import/metaculus/start', { handle: 'someone' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('metaculus');
  });

  test('a handle nobody has is a 404 from the provider, not a validation error', async () => {
    const res = await post('/api/import/manifold/start', { handle: 'nobody-here' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('nobody-here');
  });
});

describe('the gates still decide the money, through this path', () => {
  test('an account younger than 90 days is refused at start, with its age', async () => {
    mfCreated = Date.now() - 4 * DAY;
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('4 days old');
  });

  test('a bot is refused at start', async () => {
    mfIsBot = true;
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bot/i);
  });

  test('claim without the code in the bio pays nothing', async () => {
    await post('/api/import/manifold/start', { handle: 'Viktor36' });
    const res = await post('/api/import/manifold/claim', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Code not found/);
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(Number(a.balance)).toBe(0);
  });
});

describe('a paid link is visible to a reader', () => {
  const link = async () => {
    const started = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    mfBio = `forecaster. ${started.body.code} <- proof`;
    return post('/api/import/manifold/claim', {});
  };

  test('the claim pays the earn-table price once', async () => {
    const res = await link();
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(5000);
    expect(res.body.handle).toBe('Viktor36');
  });

  test('THE BADGE: the profile reports the linked handle', async () => {
    // What a visitor sees. The badge was read from a key only the deleted
    // Manifold route ever wrote, so a link made through the generic router
    // paid the credits and then showed nothing.
    await link();
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.status).toBe(200);
    expect(res.body.manifoldUsername).toBe('Viktor36');
  });

  test('THE GUARANTEE: the badge shows even when the participant is on no public floor', async () => {
    // This participant is a member of nothing, which takes the short
    // answer inside GET /:id/public. That answer used to omit both the
    // badge and the profile picture, so the same participant had an
    // identity on one code path and not on the other.
    await link();
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.activeWorkspaces).toEqual([]);
    expect(res.body.manifoldUsername).toBe('Viktor36');
    expect(res.body).toHaveProperty('image');
  });

  test('a participant with no link has no badge', async () => {
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBeNull();
  });

  test('the same participant cannot link a second time', async () => {
    await link();
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.status).toBe(409);
  });

  test('the legacy badge row still reads, so the ten links made before this keep theirs', async () => {
    // Written by the deleted route. Migration 0100 rewrites these, but a
    // reader must not depend on the migration having run.
    await db.insert(systemConfig).values({
      key: `manifold-claimed:agent:${AGENT}`,
      value: { username: 'old_account', manifoldUserId: 'mf-legacy', granted: 2840, at: Date.now() },
    });
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBe('old_account');
  });
});
