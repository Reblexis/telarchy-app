import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

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
const APP_TS_PATH = join(REPO_ROOT, 'functions/src/app.ts');
const FRONTEND_API_TS_PATH = join(REPO_ROOT, 'src/lib/api.ts');
const ROUTES_DIR = join(REPO_ROOT, 'functions/src/routes');

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

  const re = /\{\s*method:\s*'([A-Z]+)',\s*path:\s*'([^']+)',\s*auth:\s*(?:'([^']+)'|(false))/g;
  const out: DocumentedEndpoint[] = [];
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    out.push({ method: m[1], path: m[2], auth: m[3] ?? 'false' });
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
      'identity',
      'session',
      'agent',
      'agent/admin',
      'admin',
      'self/admin',
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
      '/api/auth/sign-out',      // BetterAuth handles
      '/api/auth/session',       // BetterAuth handles
      '/api/public-config',      // tiny client/server feature flag, not part of agent surface
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
