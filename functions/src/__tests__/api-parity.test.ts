import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * API parity guard: enforces that the web UI and the public API stay one
 * surface, not two. The rule lives in AGENTS.md ("Frontend goes through the
 * public API"); this test makes it executable.
 *
 * What it checks:
 * 1. Every `/api/*` path the frontend (src/lib/api.ts) calls is documented in
 *    `GET /api/help`. If a frontend page uses an endpoint nobody else can
 *    discover, that's a parity hole.
 * 2. `requireUser` (browser-session-only) is restricted to a small allowlist of
 *    routes that are intrinsically tied to BetterAuth account state. Every
 *    other use of `requireUser` would mean a UI-only handler that an API-key
 *    participant cannot reach.
 * 3. Every documented endpoint has an `auth` field drawn from the legend. New
 *    labels need to be added to the legend before they're used so participants
 *    can read the docs.
 *
 * The test is static: it reads source files and the help JSON via a regex.
 * That keeps it fast (no DB, no server boot) but means the help array must
 * stay in roughly the format we have today (one object literal per endpoint,
 * fields in `method`/`path`/`auth` order).
 */

const REPO_ROOT = resolve(__dirname, '../../..');
// The catalog moved out of app.ts on 2026-08-21 so Otto could search the
// same object the route serves; the parity checks follow it.
const APP_TS_PATH = join(REPO_ROOT, 'functions/src/lib/help-catalog.ts');
const FRONTEND_API_TS_PATH = join(REPO_ROOT, 'src/lib/api.ts');
const ROUTES_DIR = join(REPO_ROOT, 'functions/src/routes');
const FRONTEND_SRC = join(REPO_ROOT, 'src');

interface DocumentedEndpoint {
  method: string;
  path: string;
  auth: string;
}

function readDocumentedEndpoints(): DocumentedEndpoint[] {
  // The /api/help description blocks contain quoted brackets (e.g.
  // "Returns { activities:[{...}], ... }"), so we cannot just look for the
  // first "],": it lands inside a string. Match each endpoint by its
  // opening { method: ... shape directly.
  const src = readFileSync(APP_TS_PATH, 'utf8');
  const start = src.indexOf('endpoints: [');
  expect(start).toBeGreaterThan(0);
  const block = src.slice(start);

  // Match the endpoint header first, then read `auth` separately. Folding the
  // auth shape into one regex meant an entry written `auth: true` (a bare
  // boolean, not a legend label) matched nothing and vanished from the parse
  // entirely, so every check below silently skipped it. Three season
  // endpoints hid that way, including the entry toggle and the prize claim.
  // An entry we cannot read is now an error, not an omission.
  const re = /\{\s*method:\s*'([A-Z]+)',\s*path:\s*'([^']+)',\s*auth:\s*([^,]+),/g;
  const out: DocumentedEndpoint[] = [];
  const unreadable: string[] = [];
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    const rawAuth = m[3].trim();
    const quoted = /^'([^']*)'$/.exec(rawAuth);
    if (quoted) out.push({ method: m[1], path: m[2], auth: quoted[1] });
    else if (rawAuth === 'false') out.push({ method: m[1], path: m[2], auth: 'false' });
    else unreadable.push(`${m[1]} ${m[2]} -> auth:${rawAuth}`);
  }
  if (unreadable.length > 0) {
    throw new Error(
      `Endpoint(s) in /api/help have an auth value that is neither a quoted legend label nor false:\n` +
        `${unreadable.join('\n')}\n` +
        `Use a label from auth_field_legend in app.ts (e.g. 'identity' for any authenticated participant).`,
    );
  }
  return out;
}

function readFrontendApiPaths(): string[] {
  const src = readFileSync(FRONTEND_API_TS_PATH, 'utf8');
  // Capture both '/api/x' and `/api/${id}` forms; literal segments only,
  // template placeholders (`${id}`) collapse to ":param".
  const re = /[`'"](\/api\/[^`'"\s${}]*(?:\$\{[^}]+\}[^`'"\s${}]*)*)[`'"]/g;
  const paths = new Set<string>();
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    let p = m[1];
    p = p.replace(/\$\{[^}]+\}/g, ':param'); // template -> placeholder
    // A trailing `:param` with no leading `/` is a query-string suffix
    // (e.g. `/api/predictions/positions${qs}`); drop it so the path matches.
    p = p.replace(/(?<!\/):param$/, '');
    p = p.replace(/\?.*$/, ''); // strip explicit query strings
    paths.add(p);
  }
  return Array.from(paths);
}

/**
 * Build a RegExp that matches concrete paths against a documented template.
 * Both `:foo` (express-style) and the `:param` placeholder we use for
 * frontend templates collapse to the same wildcard segment.
 */
function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Replace any `/:identifier` (including our `:param`) with a `/[^/]+` wildcard.
  const wildcarded = escaped.replace(/\/:[a-zA-Z]+/g, '/[^/]+');
  return new RegExp(`^${wildcarded}$`);
}

function pathFamilyMatchesAny(frontendPath: string, documentedPaths: string[]): boolean {
  return documentedPaths.some(template => templateToRegex(template).test(frontendPath));
}

/**
 * Every frontend source file, so the HTTP-ownership check below can read all
 * of them. Tests are excluded: a test that stubs fetch is testing, not
 * calling.
 */
function frontendSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test') continue;
      frontendSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ONE module talks to the server, and it is `src/lib/api.ts`.
 *
 * This is the structural half of "the frontend goes through the public API".
 * The other checks in this file read `api.ts` and compare it against the
 * catalog; they are only worth anything if `api.ts` is the whole story. A
 * component that calls `fetch('/api/...')` directly is invisible to them, and
 * eight of them had accumulated by 2026-08-21 (waitlist in four places, the
 * Manifold import in two, guides, legal, public-config).
 *
 * Keeping HTTP in one module is also what makes Otto's access exactly a
 * visitor's access: everything the UI can do is a documented endpoint call,
 * so an assistant holding the same session can do it and nothing more.
 */
describe('API parity: one module owns HTTP', () => {
  /** Files allowed to call fetch, with the reason. Adding to this list is
   *  adding a second way for the UI to reach the server: say why. */
  const FETCH_OWNERS: Record<string, string> = {
    'lib/api.ts':
      'The API client itself: the one place that knows the base path, the credentials and the workspace header.',
  };

  test('nothing outside the api client calls fetch', () => {
    const offenders: string[] = [];
    for (const file of frontendSourceFiles(FRONTEND_SRC)) {
      const rel = file.slice(FRONTEND_SRC.length + 1);
      if (rel in FETCH_OWNERS) continue;
      const src = readFileSync(file, 'utf8');
      if (/\bfetch\s*\(/.test(src)) offenders.push(rel);
    }

    if (offenders.length > 0) {
      throw new Error(
        `These frontend files call fetch directly: ${offenders.join(', ')}.\n` +
          `Move the call into src/lib/api.ts and call it from here, so the parity checks in this\n` +
          `file can see it and so every request carries the same credentials and base path.\n` +
          `(See AGENTS.md "Frontend goes through the public API".)`,
      );
    }
  });

  test('the api client is where the fetches went', () => {
    // Guards the check above against a regex that stops matching: if this
    // number collapses, the sweep is passing because it found nothing.
    const src = readFileSync(FRONTEND_API_TS_PATH, 'utf8');
    expect((src.match(/\bfetch\s*\(/g) ?? []).length).toBeGreaterThan(3);
  });
});

describe('API parity: frontend goes through the public API', () => {
  let documented: DocumentedEndpoint[];

  beforeAll(() => {
    documented = readDocumentedEndpoints();
  });

  test('parses a non-empty endpoint list from /api/help', () => {
    expect(documented.length).toBeGreaterThan(40);
  });

  test('every documented endpoint has a known auth label', () => {
    const allowedLabels = new Set([
      'false',
      'optional',
      'identity',
      'session',
      'agent',
      'agent/admin',
      'admin',
      // Reads a public workspace answers with no credentials at all: send
      // X-Workspace-Id and nothing else (owner direction 2026-08-20, only
      // actions need a key). Distinct from 'false', which is a route with no
      // workspace and no gate, and from 'agent', which needs an identity.
      'public-read',
      'self/admin',
      // The granular workspace-lifecycle capability, which 'admin' (manage)
      // does NOT imply: deleting a workspace, changing its visibility, and the
      // auto-fund and penalty settings all need it, and a teammate promoted to
      // the seeded Admin group does not have it.
      'manage_workspace',
      // Platform-wide, and deliberately not satisfied by owning a workspace:
      // prize-season settlement assigns real money, so a workspace owner must
      // not reach it the way 'admin' (the manage capability) would allow.
      'platform admin',
    ]);
    const offenders = documented.filter(e => !allowedLabels.has(e.auth));
    if (offenders.length > 0) {
      const detail = offenders.map(e => `${e.method} ${e.path} -> auth:${e.auth}`).join('\n');
      throw new Error(
        `Endpoint(s) use auth labels not described in auth_field_legend:\n${detail}\n` +
          `Either fix the label or extend the legend in app.ts.`,
      );
    }
  });

  test('every /api path the frontend calls is documented', () => {
    const documentedPaths = documented.map(e => e.path);

    // Endpoints handled by BetterAuth (not by our routers) and a few public
    // helpers that don't belong in /api/help. These are the only paths the
    // frontend may hit without a corresponding /api/help entry.
    const allowlist = new Set([
      '/api/auth/sign-in/email', // BetterAuth handles
      '/api/auth/sign-up/email', // BetterAuth handles
      '/api/auth/sign-out', // BetterAuth handles
      '/api/auth/session', // BetterAuth handles
    ]);

    const frontendPaths = readFrontendApiPaths().filter(p => !allowlist.has(p));
    const undocumented = frontendPaths.filter(p => !pathFamilyMatchesAny(p, documentedPaths));

    if (undocumented.length > 0) {
      throw new Error(
        `Frontend calls /api paths not documented in GET /api/help:\n${undocumented.join('\n')}\n` +
          `Either add them to the help endpoint list or move the frontend to a documented route.\n` +
          `(See AGENTS.md "Frontend goes through the public API".)`,
      );
    }
  });

  test('requireUser is reserved for endpoints intrinsically tied to browser-account state', () => {
    // Allowlist = files where requireUser is acceptable. Right now the only
    // legit case is /api/auth/consent, since consent is a browser-account
    // concept and agent-key callers are exempt via middleware/consent.ts.
    // Everything else must use requireIdentity / requireSelfOrAdmin /
    // requireCapability so API participants can reach the same surface.
    const allowedFiles = new Set<string>([
      // (filename relative to routes/, e.g. 'userauth.ts')
      'userauth.ts', // ONE permitted use: the consent endpoint. Tested separately below.
    ]);

    const offenders: string[] = [];
    for (const file of readdirSync(ROUTES_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
      if (!/\brequireUser\b/.test(src)) continue;
      if (!allowedFiles.has(file)) {
        offenders.push(file);
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        `requireUser used outside the allowlist in: ${offenders.join(', ')}.\n` +
          `If the route really must be browser-only, add the filename to allowedFiles in this test\n` +
          `and document the reason. Otherwise switch to requireIdentity / requireSelfOrAdmin /\n` +
          `requireCapability so agent-key participants can reach it too.`,
      );
    }
  });

  test('the only requireUser use in userauth.ts is /consent', () => {
    const src = readFileSync(join(ROUTES_DIR, 'userauth.ts'), 'utf8');
    // Find every router.<method>(... requireUser, ...)
    const re = /userauthRouter\.(get|post|put|delete|patch)\(\s*'([^']+)'[^)]*requireUser/g;
    const browserOnly: string[] = [];
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      browserOnly.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
    expect(browserOnly).toEqual(['POST /consent']);
  });

  test('participant-symmetric routes use requireIdentity, not requireUser', () => {
    // Self-check that the userauth refactor stuck: every route except
    // /consent must accept agent-key auth via requireIdentity.
    const src = readFileSync(join(ROUTES_DIR, 'userauth.ts'), 'utf8');
    const re = /userauthRouter\.(get|post|put|delete|patch)\(\s*'([^']+)'\s*,\s*([A-Za-z]+)/g;
    const middlewareByPath: Record<string, string> = {};
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      middlewareByPath[`${m[1].toUpperCase()} ${m[2]}`] = m[3];
    }

    for (const route of ['GET /me', 'POST /profile', 'DELETE /me', 'GET /me/export']) {
      expect({ route, middleware: middlewareByPath[route] }).toEqual({
        route,
        middleware: 'requireIdentity',
      });
    }
    expect(middlewareByPath['POST /consent']).toBe('requireUser');
  });
});

/**
 * The checks above run frontend -> catalog. These run route -> catalog and
 * catalog -> route, which is the direction that actually drifted.
 *
 * A registered route missing from /api/help is invisible: an agent author
 * reading the catalog concludes the action is impossible, gives up, and
 * reaches for the master key instead. That is how a bot ends up holding an
 * operator credential to do something a scoped key should have covered.
 * `POST /api/predictions/markets/:id/resolve` sat unlisted this way even
 * though any workspace admin could call it and it settles real positions.
 *
 * A catalog entry with no route is worse, because the agent writes code
 * against it and finds out at runtime. `DELETE /api/predictions/markets/:id`
 * was documented long after the route was replaced by `/void`.
 */

/**
 * Mount prefixes, mirroring the `app.use('/api/...', xRouter)` calls in
 * app.ts. Held as data rather than parsed out of app.ts on purpose: parsing
 * would make a mount typo agree with itself, whereas this way it surfaces as
 * a parity failure.
 */
const ROUTER_MOUNTS: Record<string, string> = {
  'userauth.ts': '/api/auth',
  'guides.ts': '/api/guides',
  'legal.ts': '/api/legal',
  'data-room.ts': '/api/data-room',
  'cron.ts': '/api/cron',
  'waitlist.ts': '/api/waitlist',
  'manifold.ts': '/api/import/manifold',
  'recordLinks.ts': '/api/import',
  'onboard.ts': '/api/onboard',
  'setup.ts': '/api/setup',
  'agents.ts': '/api/agents',
  'predictions.ts': '/api/predictions',
  'events.ts': '/api/events',
  'proposals.ts': '/api/proposals',
  'marketplace.ts': '/api/marketplace',
  'leaderboard.ts': '/api/leaderboard',
  'seasons.ts': '/api/seasons',
  'notifications.ts': '/api/notifications',
  'feedback.ts': '/api/feedback',
  'sources.ts': '/api/sources',
  'metrics.ts': '/api/metrics',
  'updates.ts': '/api/updates',
  'workspaces.ts': '/api/workspaces',
  'groups.ts': '/api/groups',
  'admin.ts': '/api/admin',
  'activity.ts': '/api/activity',
  'system.ts': '/api',
  'liquidityPurchases.ts': '/api',
};

/**
 * Routes deliberately absent from /api/help. Each needs a real reason:
 * "undocumented" is the default failure this guards against, so an
 * unexplained entry here is how the exemption list becomes the loophole.
 */
const UNDOCUMENTED_BY_DESIGN: Record<string, string> = {
  'GET /api/sources/github/callback':
    'OAuth redirect target that GitHub hits during the install flow. Not an action any caller invokes, and publishing it would invite people to call it directly.',
};

/** Catalog entries with no router behind them, permitted only where app.ts serves the path itself. */
const SERVED_OUTSIDE_ROUTERS: Record<string, string> = {
  'POST /api/stripe/webhook':
    'Mounted directly in app.ts with express.raw BEFORE the JSON parser, because Stripe signature verification needs the exact signed bytes; authenticated by that signature, not by the auth policy.',
  'GET /api/help':
    'The catalog itself, served by app.ts rather than by a mounted router, so it can never appear in the router scan.',
  'GET /api/public-config':
    'Instance feature flags, served inline by app.ts next to /api/help; documented in the catalog since 2026-08-24, invisible to the router scan.',
};

/** Param names differ between catalog and code (:id vs :proposalId); compare shapes. */
const normaliseRoute = (k: string) => k.replace(/:[A-Za-z]+/g, ':x');

function readRegisteredRoutes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, prefix] of Object.entries(ROUTER_MOUNTS)) {
    const full = join(ROUTES_DIR, file);
    let src: string;
    try {
      src = readFileSync(full, 'utf8');
    } catch {
      continue; // router file removed; the catalog check will flag the orphans
    }
    const re = /\b\w*Router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g;
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      const method = m[1].toUpperCase();
      const sub = m[2] === '/' ? '' : m[2];
      const path = (prefix + sub).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      found.set(`${method} ${path}`, file);
    }
  }
  return found;
}

describe('API parity: /api/help is a complete map of the API', () => {
  test('every router app.ts mounts is in ROUTER_MOUNTS, so the scan cannot silently skip a new one', () => {
    const appTs = readFileSync(join(REPO_ROOT, 'functions/src/app.ts'), 'utf8');
    const imported = [...appTs.matchAll(/from '\.\/routes\/([\w-]+)'/g)].map(m => `${m[1]}.ts`);
    const missing = imported.filter(f => !(f in ROUTER_MOUNTS));
    expect(missing).toEqual([]);
  });

  let documented: DocumentedEndpoint[];
  let registered: Map<string, string>;

  beforeAll(() => {
    documented = readDocumentedEndpoints();
    registered = readRegisteredRoutes();
  });

  test('the router scan finds a plausible number of routes', () => {
    // Guards against a regex that silently matches nothing, which would make
    // the two assertions below pass vacuously.
    expect(registered.size).toBeGreaterThan(100);
  });

  test('every registered route is documented in /api/help', () => {
    const documentedShapes = new Set(documented.map(e => normaliseRoute(`${e.method} ${e.path.replace(/\/$/, '')}`)));

    const undocumented = [...registered.entries()]
      .filter(([route]) => !documentedShapes.has(normaliseRoute(route)))
      .filter(([route]) => !(route in UNDOCUMENTED_BY_DESIGN))
      .map(([route, file]) => `${route}  (routes/${file})`)
      .sort();

    if (undocumented.length > 0) {
      throw new Error(
        `Route(s) registered but missing from the /api/help catalog in app.ts:\n${undocumented.join('\n')}\n` +
          `Every human action must be reachable by a bot, and a bot only sees what /api/help lists.\n` +
          `Add the catalog entry in the same commit as the route, or add the route to\n` +
          `UNDOCUMENTED_BY_DESIGN in this test with a reason.\n` +
          `(See AGENTS.md "Frontend goes through the public API".)`,
      );
    }
  });

  test('every documented endpoint has a route behind it', () => {
    const registeredShapes = new Set([...registered.keys()].map(normaliseRoute));

    const phantom = documented
      .map(e => `${e.method} ${e.path.replace(/\/$/, '')}`)
      .filter(route => !registeredShapes.has(normaliseRoute(route)))
      .filter(route => !(route in SERVED_OUTSIDE_ROUTERS))
      .sort();

    if (phantom.length > 0) {
      throw new Error(
        `Endpoint(s) documented in /api/help with no router registering them:\n${phantom.join('\n')}\n` +
          `An agent that trusts the catalog will write code against these and get a 404.\n` +
          `Remove the entry from app.ts, or restore the route.`,
      );
    }
  });

  test('nothing is exempted without a stated reason', () => {
    for (const [route, reason] of Object.entries({
      ...UNDOCUMENTED_BY_DESIGN,
      ...SERVED_OUTSIDE_ROUTERS,
    })) {
      expect(`${route}: ${reason}`.length).toBeGreaterThan(60);
    }
  });
});
