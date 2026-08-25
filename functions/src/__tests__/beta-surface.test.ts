/**
 * The beta lives at telarchy.com/beta (owner ask 2026-08-20: "couldnt u just
 * host it directly on telarchy.com/beta? this way it would also better support
 * other testers than me").
 *
 * Two things have to hold for that to be more than a URL:
 *
 *  1. `/beta/api/...` reaches the SAME API handlers as `/api/...`. The beta
 *     bundle is built with its API base at /beta, so every call it makes
 *     arrives prefixed. A second copy of the API mounted under /beta would be
 *     two code paths for one capability and would drift.
 *  2. The prefix is a path SEGMENT. `/betamax` is a workspace slug and must
 *     stay on the published site; getting that wrong hijacks a market page.
 */

jest.mock('./harness/test-db', () => require('./harness/test-db'));

import express from 'express';
import request from 'supertest';
import { BETA_PREFIX, isBetaPath } from '../lib/beta-surface';

describe('what counts as the beta', () => {
  test('the prefix itself and everything under it', () => {
    expect(isBetaPath('/beta')).toBe(true);
    expect(isBetaPath('/beta/')).toBe(true);
    expect(isBetaPath('/beta/lookpilot')).toBe(true);
    expect(isBetaPath('/beta/api/status')).toBe(true);
    expect(isBetaPath('/beta/assets/index-abc.js')).toBe(true);
  });

  test('a slug that merely starts with the word does not', () => {
    // The bug this prevents: telarchy.com/betamax is a market, and routing it
    // to an unpublished build would hand a visitor the wrong app.
    expect(isBetaPath('/betamax')).toBe(false);
    expect(isBetaPath('/beta-testing')).toBe(false);
    expect(isBetaPath('/')).toBe(false);
    expect(isBetaPath('/lookpilot')).toBe(false);
  });

  test('the prefix is one place, not a literal sprinkled around', () => {
    expect(BETA_PREFIX).toBe('/beta');
  });
});

/**
 * The rewrite that makes one API serve both prefixes. Mirrors the middleware
 * in app.ts; kept as a table because the interesting cases are the ones that
 * must NOT be rewritten.
 */
function rewrite(url: string): string {
  if (url === '/beta/api' || url.startsWith('/beta/api/') || url.startsWith('/beta/api?')) {
    return url.slice('/beta'.length);
  }
  return url;
}

describe('the beta API prefix is stripped before routing', () => {
  test('an API call from the beta bundle reaches the normal handler', () => {
    expect(rewrite('/beta/api/status')).toBe('/api/status');
    expect(rewrite('/beta/api/marketplace/lookpilot')).toBe('/api/marketplace/lookpilot');
    expect(rewrite('/beta/api')).toBe('/api');
    expect(rewrite('/beta/api?x=1')).toBe('/api?x=1');
  });

  test('a page under the beta is left alone for the static handler', () => {
    expect(rewrite('/beta/lookpilot')).toBe('/beta/lookpilot');
    expect(rewrite('/beta/assets/index.js')).toBe('/beta/assets/index.js');
  });

  test('the published site is untouched', () => {
    expect(rewrite('/api/status')).toBe('/api/status');
    expect(rewrite('/lookpilot')).toBe('/lookpilot');
    expect(rewrite('/betamax/api/status')).toBe('/betamax/api/status');
  });

  test('end to end through express: /beta/api hits the same route', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.url = rewrite(req.url);
      next();
    });
    app.get('/api/status', (_req, res) => {
      res.json({ ok: true });
    });

    expect((await request(app).get('/api/status')).body).toEqual({ ok: true });
    expect((await request(app).get('/beta/api/status')).body).toEqual({ ok: true });
    // And a market whose name starts with the prefix is not swallowed.
    expect((await request(app).get('/betamax/api/status')).status).toBe(404);
  });
});
