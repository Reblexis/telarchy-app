import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { originAllowedForCors } from './origins';

/**
 * Who may call this API from a browser. Two policies, because two kinds of
 * route live here.
 *
 * The brief (`/context`) and the question box (`/ask`) are anonymous by design
 * and exist to be read from somewhere else: LookPilot's data room embeds them
 * from its own origin, and any agent may fetch the brief. They carry no
 * cookies, spend no session, and answer the same facts to everyone, so they
 * are open to EVERY origin and explicitly WITHOUT credentials, exactly like
 * the data room's own JSON feed.
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
const PUBLIC_CORS_PATH = /^\/api\/marketplace\/[^/]+\/(context|ask)$/;

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
