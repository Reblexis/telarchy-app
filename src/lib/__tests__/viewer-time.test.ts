import { describe, expect, test } from 'vitest';
import { clockOf, countdownTo, dayOf, instantOf, pollIntervalFor, tickIntervalFor } from '../viewer-time';

/**
 * Every clock on the floor reads in the viewer's zone (docs/ui-conventions.md,
 * "Every clock on the floor reads in the viewer's zone"; Viktor 2026-09-11:
 * "the time shown has to be local for the viewer"). The helpers take the zone
 * as a parameter so the tests pin one; the floor passes none and gets the
 * browser's.
 */
const Z = 'Europe/Prague'; // UTC+2 in September

describe('instants read in the viewer zone', () => {
  test('a clock is the local hour and minute, no zone word', () => {
    expect(clockOf('2026-09-11T10:38:00Z', Z)).toBe('12:38');
    expect(clockOf('2026-09-11T22:05:00Z', 'America/New_York')).toBe('18:05');
  });
  test('an instant carries the local day, clock and the short zone name, once', () => {
    expect(instantOf('2026-09-11T10:38:00Z', Z)).toBe('11 Sep 2026, 12:38 CEST');
    expect(instantOf('2026-09-30T23:59:00Z', Z)).toBe('1 Oct 2026, 01:59 CEST');
    expect(instantOf('not a date', Z)).toBe('');
  });
  test('a day is the local day, so a late-evening UTC instant is tomorrow east of Greenwich', () => {
    expect(dayOf('2026-09-11T23:30:00Z', Z)).toBe('12 Sep');
    expect(dayOf('2026-09-11T10:00:00Z', Z)).toBe('11 Sep');
    expect(dayOf(null, Z)).toBe('');
  });
});

describe('the deadline counts down by the second under an hour', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 8, 11, 10, 0, 0) + s * 1000).toISOString();
  const now = Date.UTC(2026, 8, 11, 10, 0, 0);
  test('m:ss under an hour, seconds zero-padded', () => {
    expect(countdownTo(at(31), now)).toEqual({ label: '0:31', urgent: true });
    expect(countdownTo(at(5 * 60 + 31), now)).toEqual({ label: '5:31', urgent: true });
    expect(countdownTo(at(3599), now)).toEqual({ label: '59:59', urgent: true });
    expect(countdownTo(at(9), now)).toEqual({ label: '0:09', urgent: true });
  });
  test('hours under a day, days above, "now" at and after the instant', () => {
    expect(countdownTo(at(3600), now)).toEqual({ label: '1h', urgent: true });
    expect(countdownTo(at(5 * 3600), now)).toEqual({ label: '5h', urgent: true });
    expect(countdownTo(at(6 * 24 * 3600 - 1), now)).toEqual({ label: '6d', urgent: false });
    expect(countdownTo(at(0), now)).toEqual({ label: 'now', urgent: true });
    expect(countdownTo(at(-5), now)).toEqual({ label: 'now', urgent: true });
  });
  test('seconds never round up to the next minute', () => {
    expect(countdownTo(at(60), now).label).toBe('1:00');
    expect(countdownTo(at(59.9), now).label).toBe('0:59');
  });
});

describe('the clocks tick and the floor polls at the rate the nearest deadline moves', () => {
  const now = Date.UTC(2026, 8, 11, 10, 0, 0);
  const pending = (s: number) => ({ status: 'pending', decideBy: new Date(now + s * 1000).toISOString() });
  test('a pending deadline under an hour ticks every second, otherwise every minute', () => {
    expect(tickIntervalFor([pending(30 * 60)], now)).toBe(1000);
    expect(tickIntervalFor([pending(2 * 3600)], now)).toBe(60_000);
    expect(tickIntervalFor([], now)).toBe(60_000);
    // A decided proposal has no clock to tick.
    expect(tickIntervalFor([{ status: 'approved', decideBy: pending(10).decideBy }], now)).toBe(60_000);
  });
  test('a pending deadline within five minutes polls every five seconds, otherwise fifteen', () => {
    expect(pollIntervalFor([pending(4 * 60)], now)).toBe(5000);
    expect(pollIntervalFor([pending(6 * 60)], now)).toBe(15_000);
    expect(pollIntervalFor([pending(-10)], now)).toBe(15_000); // lapsed: nothing to watch
    // A fed floor keeps fifteen: the feed reloads the payload at every step and ruling.
    expect(pollIntervalFor([pending(4 * 60)], now, { fed: true })).toBe(15_000);
    expect(pollIntervalFor([pending(4 * 60)], now, { fed: false })).toBe(5000);
    expect(pollIntervalFor([], now)).toBe(15_000);
  });
});
