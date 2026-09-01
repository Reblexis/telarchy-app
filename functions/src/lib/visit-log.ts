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

/**
 * Whether a logged path is a PAGE somebody looked at.
 *
 * The log is written from the app's catch-all route, so everything that is
 * not a matched static file lands in it: a missing `/favicon.ico`, an
 * `/assets/*.js` chunk the browser asked for, a scanner's `/lala.php`. Those
 * are requests, not visits, and reading them as steps made `/favicon.ico` the
 * second most common place a visitor "stopped" when this ran against real
 * traffic on 2026-09-01.
 *
 * THE RULE IS THE EXTENSION, NOT A LIST OF KNOWN PAGES, and that is the whole
 * design: a page added next year has no extension, so it becomes a journey
 * step without anybody remembering to register it, while a new asset type is
 * excluded by the same sentence. A list of routes would have to be edited
 * every time the site grows, and the day it was not edited it would silently
 * report zero for the newest page.
 *
 * Filtering happens on READ, here, and not at log time: the counts and the
 * public data room publish totals derived from those same rows, and moving
 * what they count is a separate decision from what a journey is made of.
 */
export function isPageLoad(path: string): boolean {
  if (!shouldLogVisit(path)) return false; // the operator's own pages
  if (path.startsWith('/__/')) return false; // hosting infrastructure
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return true;
  // `.html` is a document; everything else with an extension is an asset or
  // a probe for one.
  return /^\.html?$/i.test(last.slice(dot));
}

/** One row of the visitor log, as much of it as a journey needs. */
export interface VisitRow {
  ts: Date;
  path: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  country: string | null;
}

export interface JourneyStep {
  path: string;
  ts: Date;
  /** Seconds until this visitor's next page load; null on the last step,
   *  where the log cannot know when they left. */
  secondsOnPage: number | null;
}

export interface Journey {
  id: string;
  ip: string;
  userAgent: string | null;
  country: string | null;
  /** The referer of the FIRST hit: which channel delivered them. */
  referer: string | null;
  startedAt: Date;
  entryPath: string;
  exitPath: string;
  durationSeconds: number;
  bounced: boolean;
  steps: JourneyStep[];
}

/** Idle time that ends a sitting. Thirty minutes is the analytics convention,
 *  and the point is that a visitor who comes back tomorrow reads as two
 *  visits rather than one impossible overnight session. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * One visitor's ordered path through the site, in a single sitting.
 *
 * This is the cheap half of session replay: the ORDER OF PAGES for every
 * anonymous visitor, reconstructed from the log already being written, with
 * no script on the page, no cookie and therefore no consent banner. It does
 * not see clicks inside a page; `notes/session-replay-2026-09-01.md` is what
 * that would cost.
 *
 * The rules are docs/ui-conventions.md, "Journeys". Two are worth their
 * reasons here because both are the safe side of a real error:
 *
 * - A visitor is an address AND a user agent. One address is a household,
 *   an office or a phone network, so keying on the address alone invents a
 *   journey nobody took; splitting one person across two browsers is the
 *   harmless direction of the same mistake.
 * - A row with no address is dropped rather than grouped with the other
 *   nulls, which would stitch unrelated strangers into a single fictional
 *   journey. The counts already treat those rows as unattributable.
 *
 * The caller is responsible for having filtered the rows to humanish ones
 * (`humanVisitFilter()`); a crawler walking forty pages would otherwise be
 * the longest journey on the page.
 */
export function sessionize(rows: VisitRow[]): Journey[] {
  const byVisitor = new Map<string, VisitRow[]>();
  for (const row of rows) {
    if (!row.ip) continue;
    if (!isPageLoad(row.path)) continue;
    const key = `${row.ip}\n${row.userAgent ?? ''}`;
    const bucket = byVisitor.get(key);
    if (bucket) bucket.push(row);
    else byVisitor.set(key, [row]);
  }

  const journeys: Journey[] = [];
  for (const visits of byVisitor.values()) {
    // Stable, so two hits sharing a timestamp keep the order they arrived in
    // rather than swapping between reads of the same log.
    visits.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    let sitting: VisitRow[] = [];
    const flush = () => {
      if (sitting.length) journeys.push(toJourney(sitting));
      sitting = [];
    };
    for (const visit of visits) {
      const previous = sitting[sitting.length - 1];
      // Measured from the PREVIOUS hit, not from the start: six pages five
      // minutes apart is one half-hour sitting, not two sessions.
      if (previous && visit.ts.getTime() - previous.ts.getTime() > SESSION_IDLE_MS) flush();
      sitting.push(visit);
    }
    flush();
  }

  return journeys.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function toJourney(sitting: VisitRow[]): Journey {
  const first = sitting[0];
  const last = sitting[sitting.length - 1];
  const steps: JourneyStep[] = sitting.map((visit, i) => {
    const next = sitting[i + 1];
    return {
      path: visit.path,
      ts: visit.ts,
      secondsOnPage: next ? Math.round((next.ts.getTime() - visit.ts.getTime()) / 1000) : null,
    };
  });
  return {
    id: `${first.ip}|${first.userAgent ?? ''}|${first.ts.toISOString()}`,
    ip: first.ip as string,
    userAgent: first.userAgent,
    country: sitting.find(v => v.country)?.country ?? null,
    referer: first.referer,
    startedAt: first.ts,
    entryPath: first.path,
    exitPath: last.path,
    durationSeconds: Math.round((last.ts.getTime() - first.ts.getTime()) / 1000),
    bounced: sitting.length === 1,
    steps,
  };
}
