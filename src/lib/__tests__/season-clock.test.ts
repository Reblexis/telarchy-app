import { describe, expect, test } from 'vitest';
import type { PrizeSeason } from '../api';
import { clockTickMs, pickCurrentSeason, seasonClock } from '../season-clock';

/**
 * The season countdown.
 *
 * One module because four surfaces show this fact (the floor strip, the
 * account entry panel, the leaderboard banner, the standings page) and each of
 * them used to round the same milliseconds its own way, which is how "3 days
 * left" and "2 days left" end up on one screen.
 *
 * The load-bearing case is `before`: entry opens while a season is still a
 * draft (owner direction 2026-08-18), so a season that has not started is a
 * real state with its own countdown, not an empty one to hide.
 */

const AUG20 = '2026-08-20T00:00:00.000Z';
const OCT16 = '2026-10-16T00:00:00.000Z';

function season(over: Partial<PrizeSeason> = {}): PrizeSeason {
  return {
    id: 's1',
    name: 'Season 1',
    status: 'draft',
    startsAt: AUG20,
    endsAt: OCT16,
    settledAt: null,
    poolUsd: 1000,
    ladder: [{ place: 1, prizeUsd: 500 }],
    rulesUrl: '/legal/season-1',
    ...over,
  } as PrizeSeason;
}

const at = (iso: string) => new Date(iso);

describe('a season that has not started', () => {
  test('counts down to the start, and entry is already open', () => {
    const c = seasonClock(season(), at('2026-08-18T00:00:00.000Z'));
    expect(c.phase).toBe('before');
    expect(c.days).toBe(2);
    expect(c.headline).toBe('Starts in 2 days');
    // The whole point of the change: someone can enter now.
    expect(c.entryOpen).toBe(true);
  });

  test('drops to hours and minutes as it gets close', () => {
    expect(seasonClock(season(), at('2026-08-19T14:00:00.000Z')).headline).toBe('Starts in 10 hours');
    expect(seasonClock(season(), at('2026-08-19T23:12:00.000Z')).headline).toBe('Starts in 48 min');
    expect(seasonClock(season(), at('2026-08-19T23:59:12.000Z')).headline).toBe('Starts in 48 sec');
  });

  test('a draft whose start instant has passed says so honestly', () => {
    // Nothing starts a season automatically; a platform admin presses the
    // button. Counting "0 sec" forever, or claiming it is under way, would
    // both be lies about a state only a human can leave.
    const c = seasonClock(season(), at('2026-08-21T00:00:00.000Z'));
    expect(c.phase).toBe('before');
    expect(c.headline).toBe('Starting shortly');
    expect(c.entryOpen).toBe(true);
  });
});

describe('a running season', () => {
  test('counts down to the end', () => {
    const c = seasonClock(season({ status: 'running' }), at('2026-10-10T00:00:00.000Z'));
    expect(c.phase).toBe('during');
    expect(c.headline).toBe('6 days left');
    expect(c.entryOpen).toBe(true);
  });

  test('past its end it waits on settlement rather than counting negatives', () => {
    const c = seasonClock(season({ status: 'running' }), at('2026-10-17T00:00:00.000Z'));
    expect(c.phase).toBe('ended');
    expect(c.headline).toBe('Standings are being settled');
    expect(c.entryOpen).toBe(false);
    expect(c.days).toBe(0);
  });
});

describe('a settled season', () => {
  test('has no countdown and no entry', () => {
    const c = seasonClock(season({ status: 'settled' }), at('2026-10-20T00:00:00.000Z'));
    expect(c.phase).toBe('settled');
    expect(c.target).toBeNull();
    expect(c.headline).toBe('Final standings');
    expect(c.entryOpen).toBe(false);
  });
});

describe('the phrase never reads like a stopwatch', () => {
  test('at most two units, and no zero second unit', () => {
    // "2 days 0 hours" and "2 days 4 hours 13 minutes 6 seconds" are both
    // worse than "2 days" and "2 days 4 hours".
    expect(seasonClock(season(), at('2026-08-18T00:00:00.000Z')).remaining).toBe('2 days');
    expect(seasonClock(season(), at('2026-08-17T20:00:00.000Z')).remaining).toBe('2 days 4 hours');
    expect(seasonClock(season(), at('2026-08-19T00:00:00.000Z')).remaining).toBe('1 day');
  });

  test('singulars are singular', () => {
    expect(seasonClock(season(), at('2026-08-19T23:00:00.000Z')).remaining).toBe('1 hour');
    expect(seasonClock(season({ status: 'running' }), at('2026-10-15T00:00:00.000Z')).remaining).toBe('1 day');
  });
});

describe('how often the surface repaints', () => {
  test('far away is lazy, close is live', () => {
    // A two-day countdown repainting every second is pure waste; the last
    // minute repainting every quarter hour is a broken clock.
    expect(clockTickMs(seasonClock(season(), at('2026-08-18T00:00:00.000Z')))).toBe(15 * 60_000);
    expect(clockTickMs(seasonClock(season(), at('2026-08-19T14:00:00.000Z')))).toBe(60_000);
    expect(clockTickMs(seasonClock(season(), at('2026-08-19T23:59:00.000Z')))).toBe(1000);
    // Nothing pending, nothing to repaint.
    expect(clockTickMs(seasonClock(season({ status: 'settled' }), at('2026-10-20T00:00:00.000Z')))).toBe(0);
  });
});

describe('which season a surface talks about', () => {
  const draftEarly = season({ id: 'd1', status: 'draft', startsAt: '2026-08-20T00:00:00.000Z' });
  const draftLate = season({ id: 'd2', status: 'draft', startsAt: '2026-12-01T00:00:00.000Z' });
  const running = season({ id: 'r1', status: 'running' });
  const settled = season({ id: 'x1', status: 'settled', endsAt: '2026-01-01T00:00:00.000Z' });

  test('a running season beats a draft', () => {
    expect(pickCurrentSeason([draftEarly, running, settled])?.id).toBe('r1');
  });

  test('with no running season, the soonest draft', () => {
    expect(pickCurrentSeason([draftLate, draftEarly, settled])?.id).toBe('d1');
  });

  test('with neither, the last settled one still points at its winners', () => {
    expect(pickCurrentSeason([settled])?.id).toBe('x1');
  });

  test('and nothing at all is null, not a crash', () => {
    expect(pickCurrentSeason([])).toBeNull();
  });
});
