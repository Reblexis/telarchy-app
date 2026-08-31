/**
 * Where a fresh baseline market opens: at the metric's own measured value, at
 * every horizon (owner rule 2026-08-31, docs/ui-conventions.md "Where markets
 * open").
 *
 * The bug this pins first: LookPilot's weekly market opened at the midpoint,
 * $75,000, while the metric it settles against read $45,339 and could move
 * about $1,300 in the week available to it.
 *
 * The bug this pins second, and the reason the 45-day window is gone: a
 * workspace on Manifold's published numbers opened its December revenue
 * market at $4,500, the middle of an operator-chosen 0..9,000 band, against a
 * measured run rate of $3,470. That market carried 2,000 credits, so the
 * depth that was meant to make its price worth reading was the very thing
 * making the wrong price expensive to correct.
 */

// Imported from the pure lib, NOT from services/markets: that module pulls
// in db/client, which opens a pg Pool at load. A pure test does not need a
// database, and dragging one in hung the CI job for 14 minutes with no
// output before it was killed (2026-08-15).
import { openingAnchorP } from '../lib/market-open';

const NOW = new Date('2026-08-15T12:00:00Z');

describe('openingAnchorP', () => {
  test('a week-out market anchors at the metric value, not the midpoint', () => {
    // ISO week 34 of 2026 ends within days of NOW.
    const p = openingAnchorP('2026-W34', 45338.94, 150000, NOW);
    expect(p).not.toBeNull();
    expect(p).toBeCloseTo(45338.94 / 150000, 6);
    expect(p!).toBeLessThan(0.5); // strictly below the midpoint it replaced
  });

  test('a year-out market anchors at the measured value too, not at the midpoint', () => {
    const p = openingAnchorP('2026-12', 45338.94, 150000, NOW);
    expect(p).not.toBeNull();
    expect(p).toBeCloseTo(45338.94 / 150000, 6);
  });

  test('no horizon is far enough to fall back to the midpoint', () => {
    const day = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
    for (const offset of [1, 44, 46, 200, 3650]) {
      expect(openingAnchorP(day(offset), 10, 100, NOW)).toBeCloseTo(0.1, 6);
    }
  });

  test('the measured value decides the open, not the size of the pool behind it', () => {
    // The rule this protects: depth never moves the opening price. A market
    // subsidised with 2,000 credits opens exactly where a 50-credit one does,
    // because the pool is an argument to solvency sizing and not to the price.
    expect(openingAnchorP('2027-01', 3470, 9000, NOW)).toBeCloseTo(3470 / 9000, 6);
  });

  test('refuses to anchor without a usable value or a usable range', () => {
    expect(openingAnchorP('2026-W34', null, 150000, NOW)).toBeNull();
    expect(openingAnchorP('2026-W34', NaN, 150000, NOW)).toBeNull();
    expect(openingAnchorP('2026-W34', 45338.94, 0, NOW)).toBeNull();
  });

  test('a metric sitting AT the range floor still anchors there', () => {
    // The reported bug (owner, 2026-08-31): "Telarchy revenue (USD)", range 0
    // to 1,000, reading $0 every hour, opened its daily market at $499.97.
    // Returning null here is what handed it the midpoint. p=0 is not a price
    // an LMSR can quote, but anchoredMarketState clamps into [0.02, 0.98], so
    // the book opens as low as it can hold instead of in the middle of a range
    // the number is sitting at the bottom of.
    expect(openingAnchorP('2026-W34', 0, 1000, NOW)).toBe(0);
    expect(openingAnchorP('2026-W34', 150000, 150000, NOW)).toBe(1);
  });

  test('a value outside the range anchors at the edge it is past, not the middle', () => {
    expect(openingAnchorP('2026-W34', -20, 1000, NOW)).toBeLessThan(0);
    expect(openingAnchorP('2026-W34', 1200, 1000, NOW)!).toBeGreaterThan(1);
  });

  test('a non-zero rangeMin is measured from, not assumed away', () => {
    // Manually created markets may carry their own rangeMin.
    expect(openingAnchorP('2026-W34', 150, 200, NOW, 100)).toBeCloseTo(0.5, 6);
  });

  test('a period already past never anchors', () => {
    expect(openingAnchorP('2026-07', 10, 100, NOW)).toBeNull();
  });
});
