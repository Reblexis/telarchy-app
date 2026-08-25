/**
 * How long until the season does the next thing it is going to do.
 *
 * Three surfaces show this fact: the floor's season strip, the account entry
 * panel, and the leaderboard banner. Each of them used to compute it inline
 * with its own `Math.ceil(ms / 86_400_000)`, which is how "3 days left" and
 * "2 days left" end up on the same screen. It lives here now, and
 * `season-clock-ownership.test.ts` fails if a second copy appears.
 *
 * Entry opens while a season is still a draft (owner direction 2026-08-18), so
 * `before` is a real phase with its own countdown and its own sentence, not an
 * empty state to hide.
 *
 *   before ──startsAt──► during ──endsAt──► ended ──settle──► settled
 *   "Starts in 2 days"   "6 days left"      "Standings are   "Final
 *    entry OPEN           entry OPEN         being settled"   standings"
 */

import type { PrizeSeason } from './api';

export type SeasonPhase = 'before' | 'during' | 'ended' | 'settled';

export interface SeasonClock {
  phase: SeasonPhase;
  /** The instant being counted down to, or null when nothing is pending. */
  target: Date | null;
  /** Whole units remaining to `target`, largest-first and non-negative. */
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** "2 days 4 hours" / "6 hours 12 min" / "48 sec". Empty when no target. */
  remaining: string;
  /** The whole sentence a surface can print. Never empty. */
  headline: string;
  /** Whether the entry toggle should be offered. */
  entryOpen: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Two units, never more: "2 days 4 hours" reads; "2 days 4 hours 13 minutes 6
 * seconds" is a stopwatch nobody asked for. The second unit is dropped when it
 * is zero so it never says "3 days 0 hours".
 */
function phrase(ms: number): string {
  if (ms <= 0) return 'any moment';
  if (ms >= DAY) {
    const d = Math.floor(ms / DAY);
    const h = Math.floor((ms % DAY) / HOUR);
    return h > 0 ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
  }
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MINUTE);
    return m > 0 ? `${plural(h, 'hour')} ${m} min` : plural(h, 'hour');
  }
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)} min`;
  return `${Math.max(1, Math.floor(ms / 1000))} sec`;
}

export function seasonClock(season: PrizeSeason, now: Date = new Date()): SeasonClock {
  const startsAt = new Date(season.startsAt);
  const endsAt = new Date(season.endsAt);
  const t = now.getTime();

  // Status leads, not the clock. A season whose startsAt has passed but which
  // nobody has started is still `draft`, and telling a visitor it is under way
  // when the button has not been pressed is the one thing this must not do.
  const settled = season.status === 'settled';
  const phase: SeasonPhase = settled
    ? 'settled'
    : season.status === 'draft'
      ? 'before'
      : t < endsAt.getTime()
        ? 'during'
        : 'ended';

  const target = phase === 'before' ? startsAt : phase === 'during' ? endsAt : null;
  const ms = target ? Math.max(0, target.getTime() - t) : 0;

  const remaining = target ? phrase(ms) : '';
  const headline =
    phase === 'before'
      ? // A draft whose start instant has already passed is waiting on the
        // operator, and saying "starts in 0 sec" every second would be a lie that
        // keeps getting louder.
        ms > 0
        ? `Starts in ${remaining}`
        : 'Starting shortly'
      : phase === 'during'
        ? `${remaining} left`
        : phase === 'ended'
          ? 'Standings are being settled'
          : 'Final standings';

  return {
    phase,
    target,
    days: Math.floor(ms / DAY),
    hours: Math.floor((ms % DAY) / HOUR),
    minutes: Math.floor((ms % HOUR) / MINUTE),
    seconds: Math.floor((ms % MINUTE) / 1000),
    remaining,
    headline,
    entryOpen: phase === 'before' || phase === 'during',
  };
}

/**
 * How often a surface showing this clock should re-render.
 *
 * A two-day countdown does not need a repaint every second, and a
 * two-minute one does. Exported so the tick and the text come from the same
 * decision rather than from whatever each component guessed.
 */
export function clockTickMs(clock: SeasonClock): number {
  if (!clock.target) return 0;
  const ms = clock.days * DAY + clock.hours * HOUR + clock.minutes * MINUTE + clock.seconds * 1000;
  if (ms < HOUR) return 1000;
  if (ms < DAY) return MINUTE;
  return 15 * MINUTE;
}

/**
 * Which season a surface should be talking about.
 *
 * The running one; failing that the soonest draft, because entry opens before
 * a season starts and the draft is the thing worth announcing; failing that
 * the most recently settled one, so a finished season still points at its
 * winners instead of vanishing.
 *
 * Here rather than in each component: the floor strip, the leaderboard banner
 * and the standings page all have to agree on which season is "the" season, and
 * two of them had already grown their own copy of this sort.
 */
export function pickCurrentSeason(seasons: PrizeSeason[]): PrizeSeason | null {
  const running = seasons.find(s => s.status === 'running');
  if (running) return running;
  const drafts = seasons
    .filter(s => s.status === 'draft')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  if (drafts[0]) return drafts[0];
  const settled = seasons
    .filter(s => s.status === 'settled')
    .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());
  return settled[0] ?? null;
}
