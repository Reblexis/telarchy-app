import { describe, expect, test } from 'vitest';
import {
  endOfPeriod, formatResolutionDateTime, formatTargetDateDisplay, formatTimeRemaining, toISOWeekString,
} from '../date-utils';

/**
 * The frontend's target-date arithmetic is the backend's, re-exported.
 *
 * These assertions are the ones a hand-copied fork got wrong: the frontend
 * built a week's Sunday from local-time components and read it back as UTC, so
 * for any browser east of Greenwich every weekly market showed a resolution
 * date and countdown a day short, while the API said otherwise. The runner's
 * TZ is Europe/Prague locally and UTC in CI; both must pass.
 */
describe('week periods are UTC on both sides of the wire', () => {
  test.each([
    ['2026-W33', '2026-08-16'],
    ['2026-W34', '2026-08-23'],
    ['2026-W01', '2026-01-04'],
    ['2026-W53', '2027-01-03'],
  ])('%s ends on %s', (target, sunday) => {
    expect(endOfPeriod(target)).toBe(sunday);
  });

  test('the displayed resolution moment is the last second inside the period', () => {
    expect(formatResolutionDateTime('2026-W33')).toContain('Aug 16');
    expect(formatResolutionDateTime('2026-W33')).toContain('11:59');
    expect(formatResolutionDateTime('2026-12')).toContain('Dec 31');
    expect(formatResolutionDateTime('2026')).toContain('Dec 31');
    // An hour period ends inside its own hour, not at the top of the next.
    expect(formatResolutionDateTime('2026-08-16T14')).toContain('Aug 16');
    expect(formatResolutionDateTime('2026-08-16T14')).toContain('2:59');
  });

  test('the ISO week of an instant is the backend\'s answer', () => {
    // A Sunday afternoon: the old frontend copy rounded into the next week.
    expect(toISOWeekString(new Date('2026-08-16T18:00:00Z'))).toBe('2026-W33');
    expect(toISOWeekString(new Date('2026-08-17T00:00:00Z'))).toBe('2026-W34');
  });

  test('a passed period reads as expired, not as a negative countdown', () => {
    expect(formatTimeRemaining('2020-W01')).toBe('expired');
    expect(formatTimeRemaining('2099-W01')).not.toBe('expired');
  });

  test('the granularity label still comes through', () => {
    expect(formatTargetDateDisplay('2026-W34')).toBe('2026-W34 (week)');
    expect(formatTargetDateDisplay('2026-12')).toBe('2026-12 (month)');
  });
});
