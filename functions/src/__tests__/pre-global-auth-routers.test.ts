import { readFileSync } from 'fs';
import { resolve, join } from 'path';

/**
 * Routers mounted before the global auth middleware must resolve auth
 * themselves.
 *
 * app.ts mounts several routers (predictions, proposals, marketplace,
 * seasons, feedback, ...) BEFORE `app.use('/api', authMiddleware)`. For those
 * routers nothing has populated req.auth by the time a handler runs, so each
 * one must either mount authMiddleware / optionalAuthMiddleware at router
 * level or apply authMiddleware on every route that needs identity.
 *
 * This is the test the seasons launch was missing: routes/seasons.ts shipped
 * with requireIdentity / requirePlatform gates reading a req.auth nobody set,
 * so the master key got 403 "Platform admin required" on POST /api/seasons in
 * production while the whole suite stayed green (season-lifecycle fakes auth
 * at the edge, deliberately). A unit test cannot see mount order; this static
 * check can, and it fails against that code.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const APP_TS = readFileSync(join(REPO_ROOT, 'functions/src/app.ts'), 'utf8');
const ROUTES_DIR = join(REPO_ROOT, 'functions/src/routes');

/** Router variables mounted on an /api path before the global auth line,
 *  keyed to their route file, from app.ts source order. */
function preGlobalRouters(): Array<{ mountPath: string; routerVar: string; file: string }> {
  const globalAuthAt = APP_TS.indexOf("app.use('/api', authMiddleware)");
  expect(globalAuthAt).toBeGreaterThan(-1);

  const mounts: Array<{ mountPath: string; routerVar: string; file: string }> = [];
  const mountRe = /app\.use\('(\/api\/[^']+)',\s*([^)]+)\)/g;
  for (const m of APP_TS.matchAll(mountRe)) {
    if ((m.index ?? 0) > globalAuthAt) continue;
    const args = m[2].split(',').map(s => s.trim());
    const routerVar = args[args.length - 1];
    if (!routerVar.endsWith('Router')) continue;
    // Auth resolved at the mount site (the sources pattern) is fine.
    if (args.some(a => a === 'authMiddleware' || a === 'optionalAuthMiddleware')) continue;
    const importRe = new RegExp(`import \\{[^}]*\\b${routerVar}\\b[^}]*\\} from '\\./routes/([\\w-]+)'`);
    const im = APP_TS.match(importRe);
    if (!im) continue; // not a ./routes import (e.g. BetterAuth handler)
    mounts.push({ mountPath: m[1], routerVar, file: `${im[1]}.ts` });
  }
  return mounts;
}

test('every pre-global-auth router resolves auth itself', () => {
  const offenders: string[] = [];
  for (const { mountPath, routerVar, file } of preGlobalRouters()) {
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    const routerLevel =
      src.includes(`${routerVar}.use(authMiddleware)`) ||
      src.includes(`${routerVar}.use(optionalAuthMiddleware)`);
    // A router "gates on auth" when it imports an identity gate. Matching on
    // imports rather than raw `req.auth` text keeps prose out of it: guides.ts
    // mentions req.auth inside a documentation string and is fully public.
    const gatesOnAuth =
      /import \{[^}]*\b(requireIdentity|requireCapability|requireSelfOrAdmin)\b[^}]*\} from '\.\.\/middleware/.test(src) ||
      /import \{[^}]*\bisPlatformAuthorized\b[^}]*\} from '\.\.\/lib\/platform-admin'/.test(src);
    const perRoute = /\.(get|post|put|patch|delete)\([^)]*(authMiddleware|optionalAuthMiddleware)/.test(src);
    if (gatesOnAuth && !routerLevel && !perRoute) {
      offenders.push(`${mountPath} (${file}) reads req.auth but nothing on it resolves auth`);
    }
  }
  expect(offenders).toEqual([]);
});
