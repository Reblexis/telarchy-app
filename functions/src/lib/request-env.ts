/**
 * Which database a request belongs to (owner ask 2026-08-20: "the db itself
 * should be separated into beta and full").
 *
 * THE RULE THAT MATTERS: this is decided PER REQUEST, never per revision. The
 * revision serving the beta today is the exact revision that serves
 * telarchy.com tomorrow, because publishing shifts traffic to it rather than
 * rebuilding it. An environment variable saying "I am the beta" would travel
 * with that revision through the promotion and point production traffic at the
 * beta store, which is the one failure this whole design exists to make
 * impossible.
 *
 * Two request-scoped signals, both true of a beta request and neither true of
 * a production one:
 *
 *  - the path is under `/beta/`, which is how the published revision forwards
 *    a beta request to the candidate (lib/beta-surface.ts), and
 *  - the Host is not a production host, which is how someone reaching the
 *    candidate's own run.app URL gets the beta rather than the live data.
 *
 * When neither holds, or when anything is unclear, the answer is production.
 * That is deliberate: mistaking a beta request for a production one writes
 * test data onto the live floor, which is annoying and visible, while
 * mistaking a production request for a beta one silently drops a real user's
 * trade into a store nobody reads. Prefer the loud failure.
 */

/** Hosts that serve the real thing. Everything else is a preview. Self-hosted
 *  instances set PROD_HOSTS to their own domain (.env.example). */
const PROD_HOSTS = (process.env.PROD_HOSTS ?? 'telarchy.com,www.telarchy.com')
  .split(',')
  .map(h => h.trim().toLowerCase())
  .filter(Boolean);

export function isProdHost(host: string | undefined): boolean {
  if (!host) return true; // no Host: assume production
  const bare = host.toLowerCase().split(':')[0];
  // Local development is production's database, i.e. the only one it has.
  if (bare === 'localhost' || bare === '127.0.0.1' || bare === '::1') return true;
  return PROD_HOSTS.includes(bare);
}

/**
 * True when this request should read and write the beta database.
 *
 * `path` must be the ORIGINAL path, before app.ts strips the `/beta` prefix
 * off the API routes: after the strip a beta call is indistinguishable from a
 * production one, which is the same ordering bug that made the beta serve the
 * published backend on the day it shipped.
 */
export function isBetaRequest(path: string, host: string | undefined): boolean {
  if (path === '/beta' || path.startsWith('/beta/')) return true;
  return !isProdHost(host);
}
