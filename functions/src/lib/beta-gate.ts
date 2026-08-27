/**
 * The beta is admin only (owner ask 2026-08-27: "make sure that /beta is
 * admin gated, not available to everyone"). See docs/infra/deploy.md, "The
 * beta is admin only".
 *
 * Two surfaces, one gate:
 *
 *  - `/beta/*` on the published origin, whichever build the cookie points it
 *    at (the published revision answers before it forwards anything).
 *  - Everything on a host that is not a production host: the candidate's and
 *    the previews' own run.app URLs. Only on a managed instance (one with a
 *    beta store); a self-hosted instance with one store has no beta to gate.
 *
 * A platform admin, or the master key, passes. A signed-out visitor asking
 * for a page is sent to /login and comes back through the gate; anyone else
 * gets a 404 that says nothing, because the point is that the build does
 * not exist for them. A few paths stay open on both surfaces because
 * signing in and CI's smoke test need them.
 */

import type { NextFunction, Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'http';
import { auth } from '../auth';
import { isBetaPath } from './beta-surface';
import { isMasterKey } from './master-key';
import { isPlatformAuthorized } from './platform-admin';
import { isProdHost } from './request-env';

export type BetaViewer = 'admin' | 'signed-in' | 'anonymous';

/** Paths the gate leaves open: the login page and what it needs, the smoke
 *  test's probe, hashed bundles. `/beta/<same>` counts too, since the beta
 *  bundle asks for its assets and its public-config under the prefix. */
export function isGateExempt(path: string): boolean {
  const p = path.startsWith('/beta/') ? path.slice('/beta'.length) : path;
  return (
    p === '/api/auth' ||
    p.startsWith('/api/auth/') ||
    p === '/api/public-config' ||
    p === '/login' ||
    p.startsWith('/assets/') ||
    p.startsWith('/favicon') ||
    p === '/logo.png' ||
    p === '/robots.txt'
  );
}

/** A managed instance is one with a beta store (the same rule as
 *  db/client.ts `betaStoreConfigured`, read here directly so the gate has no
 *  database import and test harnesses that stub the client keep working). */
function managedInstance(): boolean {
  return Boolean(process.env.DATABASE_BETA_URL);
}

/** True when this request is on a beta surface at all. */
export function gateApplies(path: string, host: string | undefined): boolean {
  if (isBetaPath(path)) return true;
  return managedInstance() && !isProdHost(host);
}

/** Who is asking: the master key or a platform admin, some other account, or
 *  nobody. Sessions resolve against the production user table, the one place
 *  identity lives (db/client.ts, `authDb`). */
/** Node's header bag as the Fetch Headers better-auth reads. */
function webHeaders(h: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) out.append(k, x);
    else out.set(k, v);
  }
  return out;
}

export async function betaViewer(req: Request): Promise<BetaViewer> {
  if (isMasterKey(req.headers['x-api-key'] as string | undefined)) return 'admin';
  const session = await auth.api.getSession({ headers: webHeaders(req.headers) }).catch(() => null);
  if (!session?.user) return 'anonymous';
  return (await isPlatformAuthorized({ auth: { uid: session.user.id } })) ? 'admin' : 'signed-in';
}

export function betaGate(resolve: (req: Request) => Promise<BetaViewer> = betaViewer) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!gateApplies(req.path, req.headers.host)) return next();
    if (isGateExempt(req.path)) return next();
    let who: BetaViewer = 'anonymous';
    try {
      who = await resolve(req);
    } catch (e) {
      console.error('beta gate: could not resolve the viewer', (e as Error).message);
    }
    if (who === 'admin') return next();
    const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
    if (who === 'anonymous' && wantsPage) {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    res.status(404).type('text/plain').send('Not found');
  };
}
