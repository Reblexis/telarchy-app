/**
 * Deny by default: the one place that decides which /api paths may answer
 * without credentials.
 *
 * Until 2026-08-24, whether a router required auth depended on WHERE it was
 * mounted in app.ts: everything above `app.use('/api', authMiddleware)` had to
 * authorize itself, everything below inherited the check. A router added on
 * the wrong side shipped open, silently. That is the regression a public repo
 * with outside contributors is most likely to produce, so the order dependency
 * is gone: `apiAuthPolicy` runs first on every /api request and applies
 *
 *   - `optionalAuthMiddleware` when the path is under one of the prefixes below
 *     (credentials resolved if present, never rejected here; the router's own
 *     gates, `requireCapability`, `requireIdentity`, `agentsRouter.use(authMiddleware)`
 *     for its private half, decide the rest), or
 *   - `authMiddleware` for everything else, which rejects unauthenticated calls.
 *
 * Adding a route therefore means either nothing (it is private) or one entry
 * here (it is public), and `route-auth-guard.test.ts` fails on a stale entry or
 * a bare auth mount in app.ts. `route-auth-matrix.test.ts` pins the status every
 * route returns anonymously, with an agent key and with the master key.
 *
 * Consent (`requireConsentIfUser`) is a separate, user-session concern and is
 * still applied per mount in app.ts.
 */
import type { NextFunction, Request, Response } from 'express';
import { authMiddleware, optionalAuthMiddleware } from './auth';

/**
 * Paths (exact, or with any suffix) that answer anonymous callers. Keep the
 * reason beside each entry; the guard test rejects entries no router serves.
 */
export const OPTIONAL_AUTH_PREFIXES: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: '/api', why: 'bare probe pointing at /api/help; exact path only, see matches()' },
  { prefix: '/api/help', why: 'the endpoint catalog is public' },
  { prefix: '/api/public-config', why: 'which store answered, settlement flag; no data' },
  { prefix: '/api/auth', why: 'BetterAuth sign-in/sign-up and our /me routes resolve their own session' },
  { prefix: '/api/guides', why: 'documentation' },
  { prefix: '/api/legal', why: 'terms, privacy, season rules' },
  { prefix: '/api/earn', why: 'the earn table: how free credits are priced, published like the rules' },
  { prefix: '/api/data-room', why: "Telarchy's own books, one anonymous read (docs/data-room.md)" },
  { prefix: '/api/cron', why: 'validates the master key itself, no workspace header (routes/cron.ts)' },
  { prefix: '/api/waitlist', why: 'anonymous email capture' },
  { prefix: '/api/onboard', why: 'key-first onboarding mints identities for strangers' },
  {
    prefix: '/api/agents',
    why: 'register and public profiles are anonymous; agentsRouter.use(authMiddleware) fences the private half',
  },
  { prefix: '/api/events', why: 'SSE stream gates per route on req.auth' },
  { prefix: '/api/marketplace', why: 'public listing and floors; join/ask gate per route' },
  {
    prefix: '/api/setup',
    why: 'the operator door answers anonymous visitors and must know it (the operator-door design note)',
  },
  { prefix: '/api/leaderboard', why: 'public board' },
  { prefix: '/api/seasons', why: 'public season pages; lifecycle routes gate on platform admin' },
  { prefix: '/api/notifications', why: 'per-route gates; consent applied at the mount' },
  { prefix: '/api/feedback', why: 'anonymous bug reports and ideas' },
  {
    prefix: '/api/sources',
    why: 'the GitHub OAuth callback arrives with no auth headers; routes gate with requireCapability',
  },
];

/** True when `path` is one of the optional-auth prefixes or under it. `/api` itself is exact. */
export function isOptionalAuthPath(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  for (const { prefix } of OPTIONAL_AUTH_PREFIXES) {
    if (prefix === '/api') {
      if (clean === '/api') return true;
      continue;
    }
    if (clean === prefix || clean.startsWith(prefix + '/')) return true;
  }
  return false;
}

/** Mounted once, first, on /api. See the module comment. */
export function apiAuthPolicy(req: Request, res: Response, next: NextFunction): void {
  // baseUrl + path, not originalUrl: the beta surface rewrites req.url from
  // /beta/api/... to /api/... (app.ts) while originalUrl keeps the prefix, and a
  // policy keyed on originalUrl denied every anonymous beta API call (2026-08-25).
  const path = `${req.baseUrl}${req.path}`;
  if (isOptionalAuthPath(path)) {
    void optionalAuthMiddleware(req, res, next);
  } else {
    void authMiddleware(req, res, next);
  }
}
