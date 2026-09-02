import { describe, expect, test } from 'vitest';
import { describeEntry, entryFor, repeatSentence, resolveEntry } from '../horizon-entries';

/**
 * The two kinds of horizon entry, told apart.
 *
 * The resolver mirrors the server's `toAbsoluteDate`; these cases are the ones
 * the dialog depends on to match a stored entry to the market it opened, and
 * the ones that tell an owner whether the thing they are about to stop comes
 * back tomorrow.
 */

const NOW = new Date('2026-08-31T10:00:00.000Z');

describe('reading an entry back', () => {
  test('a rolling entry says how often, not a date', () => {
    expect(describeEntry('+0d').label).toBe('Every day');
    expect(describeEntry('+1m').label).toBe('Every month');
    expect(describeEntry('+0h').every).toBe('hour');
    expect(describeEntry('+1w').ahead).toBe(1);
  });

  test('an absolute entry says the date in words and that it happens once', () => {
    expect(describeEntry('2026-12-31').label).toBe('31 December 2026, once');
    expect(describeEntry('2026-12').label).toBe('December 2026, once');
    expect(describeEntry('2026-12').every).toBe('once');
    expect(describeEntry('2026').label).toBe('2026, once');
    expect(describeEntry('2026-W36').label).toBe('Week 36 of 2026, once');
    expect(describeEntry('2026-12-31T14').label).toBe('31 December 2026, 14:00 UTC, once');
  });
});

describe('resolving an entry to the market it points at', () => {
  test('+0d is today and +1d is tomorrow', () => {
    expect(resolveEntry('+0d', NOW)).toBe('2026-08-31');
    expect(resolveEntry('+1d', NOW)).toBe('2026-09-01');
  });

  test('+0m is this month, and month arithmetic overflows exactly as the server does', () => {
    expect(resolveEntry('+0m', NOW)).toBe('2026-08');
    // The 31st plus a month is 1 October, because September has 30 days and
    // JS rolls the overflow forward. The server's toAbsoluteDate does the same
    // thing with the same call, and these two agreeing is the point: a dialog
    // that named September while the market opened in October would be worse
    // than one that says nothing.
    expect(resolveEntry('+1m', NOW)).toBe('2026-10');
    expect(resolveEntry('+1m', new Date('2026-08-15T10:00:00.000Z'))).toBe('2026-09');
  });

  test('weeks resolve to the ISO week the server writes', () => {
    expect(resolveEntry('+0w', NOW)).toBe('2026-W36');
    expect(resolveEntry('+1w', NOW)).toBe('2026-W37');
  });

  test('hours resolve to the UTC hour, and years to the year', () => {
    expect(resolveEntry('+2h', NOW)).toBe('2026-08-31T12');
    expect(resolveEntry('+1y', NOW)).toBe('2027');
  });

  test('an absolute entry resolves to itself, which is what makes it once', () => {
    expect(resolveEntry('2026-12-31', NOW)).toBe('2026-12-31');
  });
});

describe('writing an entry from the dialog', () => {
  test('a repeat stores the offset, so it rolls', () => {
    expect(entryFor('day', 0, '', '')).toBe('+0d');
    expect(entryFor('month', 1, '', '')).toBe('+1m');
  });

  test('once stores the day, and the hour when one was picked', () => {
    expect(entryFor('once', 0, '2026-12-31', '')).toBe('2026-12-31');
    expect(entryFor('once', 0, '2026-12-31', '18:00')).toBe('2026-12-31T18');
  });
});

describe('what the button promises', () => {
  test('a repeat points at the liquidity field, which sits above the button', () => {
    expect(repeatSentence('week')).toBe('A new market every week, each opening with the liquidity above.');
    expect(repeatSentence('once')).toBe('One market, on that date, and nothing after it.');
  });
});
