/**
 * `telarchy.com/beta`: the unpublished build, on the real domain.
 *
 * Owner ask 2026-08-20, after trying the first version: "couldnt u just host
 * it directly on telarchy.com/beta? this way it would also better support
 * other testers than me". Two things were wrong with a separate run.app
 * origin, and both are origin problems rather than taste:
 *
 *  - **Google login cannot work there.** Google only redirects to URIs
 *    registered on the OAuth client, and registering every future preview URL
 *    by hand in a console is not a workflow.
 *  - **A tester needs a second account session.** Different origin, different
 *    cookie jar; the person you want feedback from has to log in again on a
 *    URL that looks like nothing.
 *
 * Same origin fixes both permanently, for this beta and every future one.
 *
 * How it works. Every revision can serve itself under `/beta` (a second
 * frontend bundle built with base=/beta and its API base at /beta/api, since
 * those paths are baked in at build time). The revision serving telarchy.com
 * then forwards `/beta/*` to whichever revision carries the `candidate` tag,
 * cookies and all. So:
 *
 *   telarchy.com/          → published revision, published bundle
 *   telarchy.com/beta/     → published revision proxies → candidate revision
 *   telarchy.com/beta/api/ → same, so the beta exercises the beta's BACKEND
 *
 * That last line is the point. A preview that ran the new frontend against the
 * published API would have caught none of the three bugs that reached
 * production the week before this existed; all of them were server-side.
 *
 * The exception is `/api/auth/*`, which the beta bundle does NOT prefix,
 * because better-auth's client uses its own base URL. Those calls land on the
 * published backend, which is what keeps Google login working here: Google
 * redirects only to the URI registered on the OAuth client. So the beta runs
 * the new backend for everything except authentication; test auth changes on
 * the candidate's own URL instead. See docs/infra/deploy.md.
 */

import type { Request, Response } from 'express';
import { releaseState } from '../services/release';

export const BETA_PREFIX = '/beta';

/** True for a request the beta surface owns, including its API and assets. */
export function isBetaPath(p: string): boolean {
  return p === BETA_PREFIX || p.startsWith(`${BETA_PREFIX}/`);
}

/**
 * Forward one request to the candidate revision, unchanged apart from the
 * host it lands on.
 *
 * Cookies pass straight through, which is the whole benefit of being on one
 * origin: the session a tester already has on telarchy.com is the session the
 * beta sees, and the candidate validates it against the same database.
 *
 * Returns false when there is nothing to forward to, so the caller can serve
 * the local beta bundle instead. That keeps the beta URL meaningful even with
 * no build waiting: it then shows this build, and the stripe says so.
 */
export async function proxyToCandidate(req: Request, res: Response): Promise<boolean> {
  let target: string | null = null;
  try {
    const state = await releaseState();
    // Only the revision actually serving the site proxies. Without this the
    // candidate would forward /beta to itself, forever.
    if (!state.isServing) return false;
    target = state.candidate?.url ?? null;
  } catch (e) {
    console.error('beta: could not resolve the candidate', e);
    return false;
  }
  if (!target) return false;

  const url = `${target}${req.originalUrl}`;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // `host` must be the candidate's, and hop-by-hop headers are ours to
    // terminate. Everything else, cookies included, is the caller's.
    if (k === 'host' || k === 'connection' || k === 'content-length') continue;
    if (typeof v === 'string') headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v.join(', ');
  }

  // A streamed answer is the one case where the proxy's defaults are both
  // wrong: buffering hides the streaming, and a 20 second deadline kills an
  // answer that is still arriving. Otto's setup turns can run past that while
  // he reasons and calls the API (owner direction 2026-08-24).
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {});
  if (body !== undefined) headers['content-type'] = 'application/json';

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(wantsStream ? 180_000 : 20_000),
    });
  } catch (e) {
    console.error('beta: proxy to candidate failed', (e as Error).message);
    res.status(502).type('text/plain').send('The beta build did not answer. telarchy.com itself is unaffected.');
    return true;
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    // Let the runtime frame the body; copying these across a decoded stream
    // is how a response ends up claiming a gzip it no longer is.
    if (key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding') return;
    if (key === 'set-cookie') return; // handled below, plural
    res.setHeader(key, value);
  });
  // Node exposes multiple Set-Cookie headers only through getSetCookie().
  const cookies = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  // The beta must never be what a search engine finds.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // Pipe rather than buffer when the answer is arriving in pieces, or the
  // beta would show a whole reply at once and look like nothing changed.
  const contentType = upstream.headers.get('content-type') ?? '';
  if (upstream.body && contentType.includes('text/event-stream')) {
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const { Readable } = await import('node:stream');
    const source = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('error', e => {
      console.error('beta: stream from candidate broke', (e as Error).message);
      res.end();
    });
    source.pipe(res);
    return true;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
  return true;
}
