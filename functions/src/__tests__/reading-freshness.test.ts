import { readingIsStaleFor, settlingSoon } from '../lib/reading-freshness';

/**
 * When a reading is too old for the market about to settle on it
 * (docs/guides/sources.md, "Stale at the boundary is said out loud").
 *
 * The rule that was replaced was a flat three days, which is wrong in both
 * directions at once: an hourly market is stale within the hour, and a market
 * on next year's revenue is not stale after a week. The period the market
 * settles FOR is the only yardstick that means anything.
 */

describe('a reading measured before the period it would settle', () => {
  test('a monthly market wants a reading taken during that month', () => {
    expect(readingIsStaleFor('2026-09', new Date('2026-08-31T23:00:00Z'))).toBe(true);
    expect(readingIsStaleFor('2026-09', new Date('2026-09-01T00:01:00Z'))).toBe(false);
  });

  test('an hourly market is stale within the hour, where three days said nothing', () => {
    expect(readingIsStaleFor('2026-09-01T12', new Date('2026-09-01T11:59:00Z'))).toBe(true);
    expect(readingIsStaleFor('2026-09-01T12', new Date('2026-09-01T12:30:00Z'))).toBe(false);
  });

  test('a yearly market is not stale after a week, where three days called it stale', () => {
    expect(readingIsStaleFor('2026', new Date('2026-01-08T00:00:00Z'))).toBe(false);
  });

  test('never reported at all is the stalest case there is', () => {
    expect(readingIsStaleFor('2026-09', null)).toBe(true);
  });
});

describe('close enough to be worth saying', () => {
  const now = new Date('2026-08-31T10:00:00Z');

  test('a market inside the window counts, one outside it does not', () => {
    expect(settlingSoon('2026-08-31', now)).toBe(true);
    expect(settlingSoon('2026-12', now)).toBe(false);
  });

  test('one that has already passed its instant is not settling soon, it is settling', () => {
    expect(settlingSoon('2026-08-30', now)).toBe(false);
  });
});
