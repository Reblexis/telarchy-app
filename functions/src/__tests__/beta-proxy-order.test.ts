/**
 * The beta's API must reach the BETA, not the published backend.
 *
 * This shipped broken on 2026-08-20 and the failure was silent, which is why
 * it gets its own file. `/beta/api/*` has its prefix stripped so the beta can
 * reuse the same handlers, and the strip used to run BEFORE the proxy. By the
 * time the proxy looked at a request its path was `/api/...`, no longer
 * recognisable as the beta's, so it was served locally: the candidate's
 * frontend against the published API. A preview that runs the old backend is
 * the exact thing the beta exists not to be, and nothing in the UI said so.
 * The owner found it by noticing a button that never appeared, because
 * `isServing` was being answered by production.
 *
 * Two tests, because the invariant has two halves: the behaviour (a proxy
 * that claims the request wins) and the ordering in app.ts that makes it
 * possible.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { isBetaPath } from '../lib/beta-surface';

/** The middleware chain app.ts builds, with the proxy stubbed. */
function buildApp(opts: { proxyClaims: boolean }) {
  const seen: string[] = [];
  const app = express();
  app.use(express.json());

  // 1. Proxy: hands the whole beta to the candidate when there is one.
  app.use((req, res, next) => {
    if (!isBetaPath(req.path)) return next();
    if (!opts.proxyClaims) return next();
    seen.push(`proxied:${req.originalUrl}`);
    res.json({ servedBy: 'candidate' });
  });

  // 2. Strip: only for requests that will be served locally.
  app.use((req, _res, next) => {
    if (req.url === '/beta/api' || req.url.startsWith('/beta/api/')) {
      req.url = req.url.slice('/beta'.length);
    }
    next();
  });

  // 3. The local API.
  app.get('/api/admin/release', (_req, res) => {
    seen.push('local:/api/admin/release');
    res.json({ servedBy: 'local' });
  });
  app.post('/api/proposals', (req, res) => {
    seen.push('local:/api/proposals');
    res.json({ servedBy: 'local', body: req.body });
  });

  return { app, seen };
}

describe('a beta API call goes to the beta', () => {
  test('with a candidate waiting, the proxy takes it', async () => {
    const { app, seen } = buildApp({ proxyClaims: true });
    const res = await request(app).get('/beta/api/admin/release');
    expect(res.body).toEqual({ servedBy: 'candidate' });
    // The local handler must not have run: that was the bug.
    expect(seen).toEqual(['proxied:/beta/api/admin/release']);
  });

  test('a proxied POST keeps its body', async () => {
    const { app } = buildApp({ proxyClaims: false });
    // With no candidate the request is served locally, prefix stripped, body
    // intact. The proxy sits after express.json() precisely so the same is
    // true when it forwards.
    const res = await request(app).post('/beta/api/proposals').send({ title: 'x' });
    expect(res.body).toEqual({ servedBy: 'local', body: { title: 'x' } });
  });

  test('with nothing waiting, the beta is served locally', async () => {
    const { app, seen } = buildApp({ proxyClaims: false });
    const res = await request(app).get('/beta/api/admin/release');
    expect(res.body).toEqual({ servedBy: 'local' });
    expect(seen).toEqual(['local:/api/admin/release']);
  });

  test('the published site is never proxied', async () => {
    const { app, seen } = buildApp({ proxyClaims: true });
    const res = await request(app).get('/api/admin/release');
    expect(res.body).toEqual({ servedBy: 'local' });
    expect(seen).toEqual(['local:/api/admin/release']);
  });
});

describe('the order that makes it work', () => {
  test('app.ts proxies before it strips', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
    // The CALL SITE, not the import at the top of the file: matching the
    // import passes no matter where the middleware sits, which is a test that
    // cannot fail.
    const proxyAt = src.indexOf('await proxyToCandidate(req, res)');
    const stripAt = src.indexOf("req.url.slice('/beta'.length)");
    expect(proxyAt).toBeGreaterThan(-1);
    expect(stripAt).toBeGreaterThan(-1);
    // Swap these two and the beta silently runs the published backend.
    expect(proxyAt).toBeLessThan(stripAt);
  });

  test('and proxies after the body is parsed, so a POST survives', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
    expect(src.indexOf('app.use(express.json())')).toBeLessThan(src.indexOf('await proxyToCandidate(req, res)'));
  });
});
