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
import {
  BETA_BRANCH_COOKIE,
  BETA_PREFIX,
  handleBetaBranchChoice,
  isBetaPath,
  previewTagFromCookie,
  resolveBetaTarget,
} from '../lib/beta-surface';
import type { ReleaseState } from '../services/release';

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

/**
 * Branch previews (docs/infra/deploy.md, "Branch previews"): a cookie names
 * which tagged revision /beta forwards to. The interesting cases are the ones
 * where the cookie must NOT win: a retired tag, a malformed value, no
 * candidate at all.
 */
function state(over: Partial<ReleaseState> = {}): ReleaseState {
  return {
    serving: 'api-00100-aaa',
    candidate: { revision: 'api-00101-bbb', url: 'https://candidate---x.run.app' },
    previews: [
      { tag: 'br-setup-door-email', revision: 'api-00103-ddd', url: 'https://br-setup-door-email---x.run.app' },
      { tag: 'br-oss-lane-i', revision: 'api-00102-ccc', url: 'https://br-oss-lane-i---x.run.app' },
    ],
    running: 'api-00100-aaa',
    runningTags: [],
    isServing: true,
    error: null,
    ...over,
  };
}

describe('which build /beta forwards to', () => {
  test('no cookie: the candidate', () => {
    expect(resolveBetaTarget(state(), undefined)).toBe('https://candidate---x.run.app');
  });

  test('a cookie naming a preview that exists: that preview', () => {
    expect(resolveBetaTarget(state(), `${BETA_BRANCH_COOKIE}=br-oss-lane-i`)).toBe('https://br-oss-lane-i---x.run.app');
    // Among other cookies, with spaces, as browsers send them.
    expect(resolveBetaTarget(state(), `a=1; ${BETA_BRANCH_COOKIE}=br-setup-door-email; b=2`)).toBe(
      'https://br-setup-door-email---x.run.app',
    );
  });

  test('a cookie naming a retired preview degrades to the candidate, not an error', () => {
    expect(resolveBetaTarget(state(), `${BETA_BRANCH_COOKIE}=br-gone`)).toBe('https://candidate---x.run.app');
  });

  test('a preview can be shown even when nothing is waiting on main', () => {
    expect(resolveBetaTarget(state({ candidate: null }), `${BETA_BRANCH_COOKIE}=br-oss-lane-i`)).toBe(
      'https://br-oss-lane-i---x.run.app',
    );
    expect(resolveBetaTarget(state({ candidate: null }), undefined)).toBeNull();
  });

  test('only a well-formed br- tag counts as a choice', () => {
    expect(previewTagFromCookie(`${BETA_BRANCH_COOKIE}=br-oss-lane-i`)).toBe('br-oss-lane-i');
    expect(previewTagFromCookie(`${BETA_BRANCH_COOKIE}=candidate`)).toBeNull();
    expect(previewTagFromCookie(`${BETA_BRANCH_COOKIE}=br-Bad_Name`)).toBeNull();
    expect(previewTagFromCookie(`${BETA_BRANCH_COOKIE}=https://evil`)).toBeNull();
    expect(previewTagFromCookie(`${BETA_BRANCH_COOKIE}=`)).toBeNull();
    expect(previewTagFromCookie(undefined)).toBeNull();
  });
});

describe('choosing a build with ?branch=', () => {
  function app() {
    const a = express();
    a.use((req, res, next) => {
      if (handleBetaBranchChoice(req, res)) return;
      next();
    });
    a.all('*', (_req, res) => {
      res.json({ fellThrough: true });
    });
    return a;
  }

  test('sets the cookie for /beta and lands on /beta/', async () => {
    const res = await request(app()).get('/beta?branch=br-oss-lane-i');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/beta/');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${BETA_BRANCH_COOKIE}=br-oss-lane-i`);
    expect(cookie).toContain('Path=/beta');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  test('works on /beta/ as well, and clears with candidate or empty', async () => {
    const back = await request(app()).get('/beta/?branch=candidate');
    expect(back.status).toBe(302);
    expect(String(back.headers['set-cookie'])).toContain('Max-Age=0');
    const empty = await request(app()).get('/beta?branch=');
    expect(empty.status).toBe(302);
    expect(String(empty.headers['set-cookie'])).toContain('Max-Age=0');
  });

  test('a value that is not a preview tag is refused, never stored', async () => {
    const res = await request(app()).get('/beta?branch=https://evil.example');
    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('leaves a request carrying no ?branch= alone', async () => {
    expect((await request(app()).get('/beta')).body).toEqual({ fellThrough: true });
    expect((await request(app()).post('/beta?branch=br-x')).body).toEqual({ fellThrough: true });
  });

  /**
   * The report this answers (owner, 2026-08-29):
   * `telarchy.com/?branch=br-instrument-stat-row` served PRODUCTION, looked
   * like the branch, and every link from it walked further into production.
   * A preview link that silently shows the live site is worse than one that
   * errors, so `?branch=` answers anywhere on the site.
   */
  test('answers from anywhere on the site, landing on the beta twin', async () => {
    const root = await request(app()).get('/?branch=br-instrument-stat-row');
    expect(root.status).toBe(302);
    expect(root.headers.location).toBe('/beta/');
    expect(String(root.headers['set-cookie'])).toContain(`${BETA_BRANCH_COOKIE}=br-instrument-stat-row`);

    // A page keeps its path, so one link opens one floor on one branch.
    const floor = await request(app()).get('/lookpilot?branch=br-x');
    expect(floor.status).toBe(302);
    expect(floor.headers.location).toBe('/beta/lookpilot');

    // Already inside the beta: same rule, so a deep link re-points the build
    // instead of the stale cookie deciding.
    const deep = await request(app()).get('/beta/lookpilot?branch=br-x');
    expect(deep.status).toBe(302);
    expect(deep.headers.location).toBe('/beta/lookpilot');
  });

  test('never redirects an API caller, and never hijacks another ?branch=', async () => {
    // The API answers callers; a redirect would break every client.
    expect((await request(app()).get('/api/status?branch=br-x')).body).toEqual({ fellThrough: true });
    // Off the beta's door an unrecognised value is somebody else's param.
    expect((await request(app()).get('/lookpilot?branch=approved')).body).toEqual({ fellThrough: true });
  });
});
