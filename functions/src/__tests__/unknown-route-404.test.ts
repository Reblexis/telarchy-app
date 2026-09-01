/**
 * A path that does not exist must say so, instead of claiming an auth problem.
 *
 * `apiAuthPolicy` is mounted on /api before every router (app.ts), deliberately,
 * so that adding a route on the wrong side of a middleware cannot ship it open.
 * The side effect was that the 404 handler at the bottom of app.ts is
 * unreachable for anyone without credentials: an unknown path, a typo and a
 * wrong method all came back as `401 Unauthorized`. An agent exploring the API
 * before it knows a workspace, which is every agent's first minute, was told to
 * go and debug credentials it did not have a problem with.
 *
 * The fix must not trade away what the policy is for, so the rule this file
 * protects is narrow: a request that matches NO published endpoint is a 404,
 * and everything else reaches the auth policy exactly as it did before.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-unknown-route';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'unknown-route-secret-unknown-route-1';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import request from 'supertest';
import { app } from '../app';
import { listApiRoutes, routeMatchers } from '../lib/route-inventory';
import { ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const get = (p: string) => request(app).get(p).set('Origin', 'http://localhost');

describe('a path that does not exist', () => {
  test('answers 404, naming the path, not 401', async () => {
    const res = await get('/api/definitely-not-a-route');
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 404,
      error: 'Not found',
    });
    expect(res.body.path).toBe('/api/definitely-not-a-route');
  });

  test('a typo inside a real prefix is still a 404', async () => {
    // The exact shape an agent hits: it half-remembers the path.
    const res = await get('/api/predictions/marketz');
    expect(res.status).toBe(404);
  });

  test('a method nobody mounted on a real path is a 404, not an auth failure', async () => {
    // DELETE on the catalog: that path is served, this verb is not.
    const res = await request(app).delete('/api/help').set('Origin', 'http://localhost');
    expect(res.status).toBe(404);
  });

  test('a path a real :param route could serve is NOT turned into a 404', async () => {
    // GET /api/agents/register looks unmounted but `GET /api/agents/:id` can
    // serve it, with `register` as the id. The check answers "could anything
    // serve this", never "did the author mean this", so it must defer here.
    const res = await get('/api/agents/register');
    expect(res.status).toBe(401);
  });
});

describe('what the deny-by-default policy still refuses', () => {
  test('THE RULE: a real route that needs credentials still answers 401, never 404', async () => {
    // This is the regression that would matter. Turning auth failures into
    // 404s would hide the difference between "you may not" and "there is no
    // such thing", which is the whole point of the policy.
    const res = await get('/api/predictions/markets');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('another workspace-scoped read is unchanged', async () => {
    const res = await get('/api/metrics');
    expect(res.status).toBe(401);
  });

  test('an identity-only route is unchanged', async () => {
    const res = await get('/api/groups');
    expect(res.status).toBe(401);
  });
});

describe('public routes are untouched', () => {
  test('the catalog still answers anonymously', async () => {
    const res = await get('/api/help');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.endpoints)).toBe(true);
  });

  test('the guides still answer anonymously', async () => {
    const res = await get('/api/guides');
    expect(res.status).toBe(200);
  });

  test('the public workspace list still answers anonymously', async () => {
    const res = await get('/api/marketplace/workspaces/public');
    expect(res.status).toBe(200);
  });
});

describe('the check can never hide a route that exists', () => {
  // The outage this change could cause, pinned. A gap in the matcher would not
  // be a cosmetic error: it would answer 404 on a live endpoint. Every mounted
  // route must be recognised by the same matcher the policy consults.
  const mounted = listApiRoutes(app);
  const matchers = routeMatchers(app);
  const concrete = (p: string) => p.replace(/:[A-Za-z_]+\??/g, 'x').replace(/\*/g, 'x');

  test('there are routes to check, so the cases below are not vacuous', () => {
    expect(mounted.length).toBeGreaterThan(100);
  });

  test.each(mounted.map(r => [`${r.method} ${r.path}`, r] as const))('%s is recognised as mounted', (_label, r) => {
    const path = concrete(r.path);
    expect(matchers.some(m => m.method === r.method && m.test(path))).toBe(true);
  });
});
