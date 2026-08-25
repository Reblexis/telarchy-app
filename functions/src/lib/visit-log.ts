import { and, sql } from 'drizzle-orm';
import { pageVisits } from '../db/schema';

/**
 * Which document loads belong in the visitor log.
 *
 * The log answers one question for the owner: did a stranger show up. A
 * path that only the owner can open is not a stranger showing up, so it is
 * not recorded at all rather than filtered on read: counting it would put
 * the owner's own reading into visits, uniques and the top-pages list, and
 * filtering it on read would move those hits into the "bot hits" bucket,
 * which is a different lie. See docs/ui-conventions.md, "The cockpit".
 */
const OPERATOR_PATHS = ['/admin'];

export function shouldLogVisit(path: string): boolean {
  return !OPERATOR_PATHS.some(p => path === p || path.startsWith(`${p}/`));
}

/**
 * Which logged visits count as a person showing up.
 *
 * Before launch the raw log is almost all crawlers and vulnerability
 * scanners, so an unfiltered count means nothing: drop anything whose
 * user-agent looks like a bot, and the scanner probe paths. A heuristic,
 * not a proof, but it turns the number into "did a stranger show up".
 *
 * It lives here rather than in the route because two surfaces publish it:
 * the owner's cockpit (`/api/admin/floor-stats`) and the public data room
 * (`/api/data-room`). A public number that counts differently from the
 * private one is worse than no public number, because both look official.
 */
export function humanVisitFilter() {
  return and(
    sql`coalesce(${pageVisits.userAgent}, '') !~* '(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|python-requests|curl/|wget|headless|scan)'`,
    sql`${pageVisits.path} !~* '(wp-admin|wp-login|\\.env|\\.git|phpmyadmin|xmlrpc)'`,
  );
}
