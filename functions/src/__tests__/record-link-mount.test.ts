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
import { agentApiKeys, agents, earnClaims, earnRules, recordLinks } from '../db/schema';
import { toUnits } from '../lib/validation';
import { clearEarnRuleCache } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const AGENT = 'rl-mount-agent';
const KEY = 'rl-mount-agent-key';
const OTHER = 'rl-mount-other';
const OTHER_KEY = 'rl-mount-other-key';
const WS = 'rl-mount-ws';
const DAY = 86_400_000;

// The Manifold account under test, controllable per test.
let mfBio = '';
let mfCreated = Date.now() - 400 * DAY;
let mfLastBet = Date.now() - 2 * DAY;
let mfIsBot = false;
/** Which Manifold account the mocked API answers with, so a test can
 *  relink from one to another. */
let mfOther = false;

const realFetch = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
  await db.insert(agents).values([
    { id: AGENT, apiKeyHash: 'h-rl-mount', balance: toUnits(0) },
    { id: OTHER, apiKeyHash: 'h-rl-other', balance: toUnits(0) },
  ]);
  await db.insert(agentApiKeys).values([
    {
      hash: createHash('sha256').update(KEY).digest('hex'),
      keyId: 'rl-mount-key-id',
      agentId: AGENT,
      workspaceId: WS,
    },
    {
      hash: createHash('sha256').update(OTHER_KEY).digest('hex'),
      keyId: 'rl-mount-other-key-id',
      agentId: OTHER,
      workspaceId: WS,
    },
  ]);
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
  mfOther = false;

  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('api.manifold.markets')) {
      if (u.includes('/user/nobody-here')) return new Response('null', { status: 404 });
      const second = u.includes('/user/second_account') || (mfOther && !u.includes('/user/Viktor36'));
      return new Response(
        JSON.stringify({
          id: second ? 'mf-user-id-2' : 'mf-user-id-1',
          username: second ? 'second_account' : 'Viktor36',
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

const postAs = (agentKey: string, path: string, body: Record<string, unknown>) =>
  request(app)
    .post(path)
    .set('Origin', 'http://localhost')
    .set('X-Agent-Key', agentKey === OTHER ? OTHER_KEY : KEY)
    .send(body);

const post = (path: string, body: Record<string, unknown>) => postAs(AGENT, path, body);

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

describe('the proof is the only thing that can refuse a link', () => {
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

  test('a link made straight in the table is badged, whoever wrote it', async () => {
    // What migration 0102 leaves behind for the links made before it.
    await db.insert(recordLinks).values({
      agentId: AGENT,
      provider: 'manifold',
      externalId: 'mf-legacy',
      handle: 'old_account',
    });
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBe('old_account');
  });
});

/**
 * Linking is free; only the grant is gated (docs/record-links.md,
 * "Linking and being paid are two different things").
 *
 * Owner ask 2026-09-01: "it should be possible to link manifold account
 * even if it doesnt satisfy the criteria.. jus tfor the fun of it being
 * linked and people seeing whos who", then, on whether a paid link is
 * frozen: "no its not fixed even if paid.. they just cant extract from
 * that account again.. or from any other.."
 *
 * So the badge is always re-linkable and the money is once-only, per
 * participant AND per external account.
 */
describe('a record that does not qualify', () => {
  const linkNow = async (handle = 'Viktor36') => {
    const started = await post('/api/import/manifold/start', { handle });
    expect(started.status).toBe(200);
    mfBio = `proof: ${started.body.code}`;
    return post('/api/import/manifold/claim', {});
  };

  test('start issues a code for a 4-day-old account instead of refusing it', async () => {
    mfCreated = Date.now() - 4 * DAY;
    const res = await post('/api/import/manifold/start', { handle: 'Viktor36' });
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^telarchy-[0-9a-f]{8}$/);
  });

  test('THE RULE: it links, pays nothing, and says why', async () => {
    mfCreated = Date.now() - 4 * DAY;
    const res = await linkNow();
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(0);
    expect(res.body.why).toContain('4 days old');
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(Number(a.balance)).toBe(0);
  });

  test('the badge shows for an unpaid link, which is the whole point', async () => {
    mfCreated = Date.now() - 4 * DAY;
    await linkNow();
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBe('Viktor36');
  });

  test('a bot links and is never paid', async () => {
    mfIsBot = true;
    const res = await linkNow();
    expect(res.body.granted).toBe(0);
    expect(res.body.why).toMatch(/bot/i);
  });

  test('THE RULE: the grant is still there to collect once it qualifies', async () => {
    mfCreated = Date.now() - 4 * DAY;
    expect((await linkNow()).body.granted).toBe(0);
    mfCreated = Date.now() - 400 * DAY;
    const paid = await linkNow();
    expect(paid.body.granted).toBe(5000);
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(Number(a.balance)).toBe(toUnits(5000));
  });

  test('verifying again while it still does not qualify pays nothing twice', async () => {
    mfCreated = Date.now() - 4 * DAY;
    await linkNow();
    await linkNow();
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(Number(a.balance)).toBe(0);
    const claims = await db.select().from(earnClaims).where(eq(earnClaims.agentId, AGENT));
    expect(claims).toEqual([]);
  });
});

describe('relinking', () => {
  const linkAs = async (handle: string) => {
    const started = await post('/api/import/manifold/start', { handle });
    expect(started.status).toBe(200);
    mfBio = `proof: ${started.body.code}`;
    return post('/api/import/manifold/claim', {});
  };

  test('a paid link can still be replaced: the badge follows the new handle', async () => {
    expect((await linkAs('Viktor36')).body.granted).toBe(5000);
    mfOther = true;
    const second = await linkAs('second_account');
    expect(second.status).toBe(200);
    expect(second.body.handle).toBe('second_account');
    const res = await request(app).get(`/api/agents/${AGENT}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBe('second_account');
  });

  test('THE RULE: relinking pays nothing, not from that account and not from any other', async () => {
    expect((await linkAs('Viktor36')).body.granted).toBe(5000);
    mfOther = true;
    const second = await linkAs('second_account');
    expect(second.body.granted).toBe(0);
    expect(second.body.why).toMatch(/already been paid|already paid/i);
    const [a] = await db.select().from(agents).where(eq(agents.id, AGENT));
    expect(Number(a.balance)).toBe(toUnits(5000));
    const claims = await db.select().from(earnClaims).where(eq(earnClaims.agentId, AGENT));
    expect(claims).toHaveLength(1);
  });

  test('the released account can then be badged by somebody else', async () => {
    await linkAs('Viktor36');
    mfOther = true;
    await linkAs('second_account');
    // AGENT let go of Viktor36; OTHER can now prove and take it.
    const started = await postAs(OTHER, '/api/import/manifold/start', { handle: 'Viktor36' });
    expect(started.status).toBe(200);
    mfOther = false;
    mfBio = `proof: ${started.body.code}`;
    const claimed = await postAs(OTHER, '/api/import/manifold/claim', {});
    expect(claimed.status).toBe(200);
    const res = await request(app).get(`/api/agents/${OTHER}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBe('Viktor36');
  });

  test('THE RULE: two participants never wear the same handle', async () => {
    await linkAs('Viktor36');
    const started = await postAs(OTHER, '/api/import/manifold/start', { handle: 'Viktor36' });
    mfBio = `proof: ${started.body.code}`;
    const claimed = await postAs(OTHER, '/api/import/manifold/claim', {});
    expect(claimed.status).toBe(409);
    expect(claimed.body.error).toContain('Viktor36');
    const res = await request(app).get(`/api/agents/${OTHER}/public`).set('Origin', 'http://localhost');
    expect(res.body.manifoldUsername).toBeNull();
  });

  test('THE RULE: an account somebody was already PAID for pays nobody again', async () => {
    expect((await linkAs('Viktor36')).body.granted).toBe(5000);
    mfOther = true;
    await linkAs('second_account');
    const started = await postAs(OTHER, '/api/import/manifold/start', { handle: 'Viktor36' });
    mfOther = false;
    mfBio = `proof: ${started.body.code}`;
    const claimed = await postAs(OTHER, '/api/import/manifold/claim', {});
    expect(claimed.body.granted).toBe(0);
    const [b] = await db.select().from(agents).where(eq(agents.id, OTHER));
    expect(Number(b.balance)).toBe(0);
  });
});
