/**
 * The beta is admin only (owner ask 2026-08-27: "make sure that /beta is
 * admin gated, not available to everyone"). docs/infra/deploy.md, "The beta
 * is admin only", promises: an admin passes; a signed-out visitor asking for
 * a page is sent to /login and comes back; everyone else gets a 404 that
 * says nothing; the login page, auth, the smoke probe and hashed bundles
 * stay open; the gate covers /beta on the published origin AND every path on
 * a non-production host of a managed instance; a self-hosted instance with
 * one store is untouched.
 */

jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import express from 'express';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { type BetaViewer, betaGate, gateApplies, isGateExempt } from '../lib/beta-gate';

function app(viewer: BetaViewer) {
  const a = express();
  a.use(betaGate(async () => viewer));
  a.all('*', (req, res) => {
    res.json({ through: req.originalUrl });
  });
  return a;
}

const PROD = 'telarchy.com';
const DIRECT = 'candidate---api-ksc7usrtbq-uc.a.run.app';
const savedBeta = process.env.DATABASE_BETA_URL;

beforeEach(() => {
  process.env.DATABASE_BETA_URL = 'postgres://beta';
});
afterEach(() => {
  if (savedBeta === undefined) delete process.env.DATABASE_BETA_URL;
  else process.env.DATABASE_BETA_URL = savedBeta;
});

describe('/beta on the published origin', () => {
  test('the published site itself is never gated', async () => {
    const res = await request(app('anonymous')).get('/lookpilot').set('Host', PROD).set('Accept', 'text/html');
    expect(res.body).toEqual({ through: '/lookpilot' });
    expect((await request(app('anonymous')).get('/api/markets').set('Host', PROD)).status).toBe(200);
  });

  test('an admin passes, cookie and all', async () => {
    const res = await request(app('admin')).get('/beta/lookpilot').set('Host', PROD);
    expect(res.body).toEqual({ through: '/beta/lookpilot' });
    expect((await request(app('admin')).post('/beta/api/proposals').set('Host', PROD)).status).toBe(200);
  });

  test('signed out, a page request is sent to log in and told where to come back to', async () => {
    const res = await request(app('anonymous')).get('/beta/lookpilot?x=1').set('Host', PROD).set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2Fbeta%2Flookpilot%3Fx%3D1');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('signed out, an API call is a 404 that says nothing', async () => {
    const res = await request(app('anonymous')).get('/beta/api/marketplace/lookpilot').set('Host', PROD);
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found');
  });

  test('signed in but not an admin: 404 for a page too, never a redirect loop', async () => {
    const res = await request(app('signed-in')).get('/beta/').set('Host', PROD).set('Accept', 'text/html');
    expect(res.status).toBe(404);
  });

  test('what signing in needs stays open under the prefix', async () => {
    for (const p of ['/beta/assets/index-abc.js', '/beta/api/public-config', '/beta/login', '/beta/favicon.svg']) {
      const res = await request(app('anonymous')).get(p).set('Host', PROD);
      expect([p, res.status]).toEqual([p, 200]);
    }
  });

  test('a resolver that throws counts as nobody, not as an admin', async () => {
    const a = express();
    a.use(
      betaGate(async () => {
        throw new Error('db down');
      }),
    );
    a.all('*', (_req, res) => {
      res.json({ through: true });
    });
    expect((await request(a).get('/beta/api/x').set('Host', PROD)).status).toBe(404);
  });
});

describe("a build's own run.app URL", () => {
  test('is gated whole on a managed instance', async () => {
    const page = await request(app('anonymous')).get('/lookpilot').set('Host', DIRECT).set('Accept', 'text/html');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/login?next=%2Flookpilot');
    expect((await request(app('anonymous')).get('/api/markets').set('Host', DIRECT)).status).toBe(404);
    expect((await request(app('signed-in')).get('/').set('Host', DIRECT).set('Accept', 'text/html')).status).toBe(404);
    expect((await request(app('admin')).get('/api/markets').set('Host', DIRECT)).status).toBe(200);
  });

  test("the smoke test's probe, the login page and its bundle stay open", async () => {
    for (const p of [
      '/api/public-config',
      '/login',
      '/assets/index-abc.js',
      '/api/auth/get-session',
      '/logo.png',
      '/robots.txt',
    ]) {
      const res = await request(app('anonymous')).get(p).set('Host', DIRECT);
      expect([p, res.status]).toEqual([p, 200]);
    }
  });

  test('a self-hosted instance with one store has no beta and no gate', async () => {
    delete process.env.DATABASE_BETA_URL;
    expect(gateApplies('/lookpilot', 'my-company.example')).toBe(false);
    expect((await request(app('anonymous')).get('/api/markets').set('Host', 'my-company.example')).status).toBe(200);
    // /beta itself is still the beta there, gated or not, by path.
    expect(gateApplies('/beta/', 'my-company.example')).toBe(true);
  });

  test('localhost is production for this purpose (local dev is not gated)', () => {
    expect(gateApplies('/api/markets', 'localhost:8080')).toBe(false);
  });
});

describe('what is exempt', () => {
  test('is the login path and its needs, nothing broader', () => {
    expect(isGateExempt('/login')).toBe(true);
    expect(isGateExempt('/login/anything')).toBe(false);
    expect(isGateExempt('/signup')).toBe(false);
    expect(isGateExempt('/api/auth/callback/google')).toBe(true);
    expect(isGateExempt('/api/public-config')).toBe(true);
    expect(isGateExempt('/api/public-configs')).toBe(false);
    expect(isGateExempt('/assets/x.js')).toBe(true);
    expect(isGateExempt('/beta/assets/x.js')).toBe(true);
    expect(isGateExempt('/api/markets')).toBe(false);
    expect(isGateExempt('/beta/api/markets')).toBe(false);
  });
});

describe('where the gate sits in app.ts', () => {
  test('before the proxy, so the published revision decides for every build', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
    const gateAt = src.indexOf('app.use(betaGate())');
    const proxyAt = src.indexOf('await proxyToCandidate(req, res)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(proxyAt);
  });
});
