import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { originAllowedForCors } from './origins';

/**
 * Who may call this API from a browser. Two policies, because two kinds of
 * route live here.
 *
 * A floor's public payload (`/api/marketplace/:id`), the brief (`/context`)
 * and the question box (`/ask`) are anonymous by design and exist to be read
 * from somewhere else: LookPilot's data room embeds all three from its own
 * origin, and any agent may fetch the brief. They carry no cookies, spend no
 * session, and answer the same facts to everyone, so they are open to EVERY
 * origin and explicitly WITHOUT credentials, exactly like the data room's own
 * JSON feed.
 *
 * The data room (`/api/data-room`) is in the same set for the same reason: it
 * is Telarchy's own books, its whole claim is that anyone can fetch the URL the
 * page fetches and check the page against it, and a claim that only works from
 * one origin is a weaker claim.
 *
 * The payload is in that set because it was already being fetched from
 * lookpilot.app and silently failing: the data room's freshness check ("this
 * page says X and the market says Y, trust the market") has never once run in
 * a visitor's browser. Nothing else under /api/marketplace is opened, because
 * joining a floor is not a read.
 *
 * Everything else keeps the credentialed allowlist. A wildcard there would let
 * any page on the internet act as a signed-in user, so the two policies must
 * never merge: `Access-Control-Allow-Origin: *` together with
 * `Allow-Credentials: true` is rejected by every browser anyway, which is why
 * this picks one policy per request rather than stacking two middlewares.
 *
 * A disallowed origin is refused by OMITTING the allow header (`cb(null,
 * false)`), which is what a CORS refusal is. Handing cors an `Error` instead,
 * as this did until 2026-08-20, threw into the error handler and answered
 * `500 Internal error`: a policy decision that reads as an outage, and it cost
 * a session chasing a phantom bug before anyone noticed the Origin header was
 * the variable.
 */
const PUBLIC_CORS_PATH = /^\/api\/(data-room\/?|marketplace\/[^/]+(\/(context|ask))?)$/;

const publicCors = cors({ origin: '*', credentials: false });
const credentialedCors = cors({
  origin: (origin, cb) => cb(null, originAllowedForCors(origin)),
  credentials: true,
});

/** True when this path is one of the anonymous, embeddable routes. */
export function isPublicCorsPath(path: string): boolean {
  return PUBLIC_CORS_PATH.test(path);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isPublicCorsPath(req.path)) return publicCors(req, res, next);
  return credentialedCors(req, res, next);
}
