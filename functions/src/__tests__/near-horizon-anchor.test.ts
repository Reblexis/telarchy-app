/**
 * Where a fresh baseline market opens (2026-08-15). A near horizon opens at
 * the metric's own current value; a far one keeps the range midpoint.
 *
 * The bug this pins: LookPilot's weekly market opened at the midpoint,
 * $75,000, while the metric it settles against read $45,339 and could move
 * about $1,300 in the week available to it.
 */

// Imported from the pure lib, NOT from services/markets: that module pulls
// in db/client, which opens a pg Pool at load. A pure test does not need a
// database, and dragging one in hung the CI job for 14 minutes with no
// output before it was killed (2026-08-15).
import { NEAR_HORIZON_DAYS, nearHorizonAnchorP } from '../lib/market-open';

const NOW = new Date('2026-08-15T12:00:00Z');

describe('nearHorizonAnchorP', () => {
  test('a week-out market anchors at the metric value, not the midpoint', () => {
    // ISO week 34 of 2026 ends within days of NOW.
    const p = nearHorizonAnchorP('2026-W34', 45338.94, 150000, NOW);
    expect(p).not.toBeNull();
    expect(p).toBeCloseTo(45338.94 / 150000, 6);
    expect(p!).toBeLessThan(0.5); // strictly below the midpoint it replaced
  });

  test('a year-out market keeps the midpoint: today is not an estimate of December', () => {
    expect(nearHorizonAnchorP('2026-12', 45338.94, 150000, NOW)).toBeNull();
  });

  test('the window boundary is inclusive of near, exclusive of far', () => {
    const near = new Date(NOW.getTime() + (NEAR_HORIZON_DAYS - 2) * 86_400_000);
    const far = new Date(NOW.getTime() + (NEAR_HORIZON_DAYS + 5) * 86_400_000);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    expect(nearHorizonAnchorP(day(near), 10, 100, NOW)).toBeCloseTo(0.1, 6);
    expect(nearHorizonAnchorP(day(far), 10, 100, NOW)).toBeNull();
  });

  test('refuses to anchor without a usable value or a usable range', () => {
    expect(nearHorizonAnchorP('2026-W34', null, 150000, NOW)).toBeNull();
    expect(nearHorizonAnchorP('2026-W34', NaN, 150000, NOW)).toBeNull();
    expect(nearHorizonAnchorP('2026-W34', 45338.94, 0, NOW)).toBeNull();
  });

  test('a metric sitting AT the range floor still anchors there', () => {
    // The reported bug (owner, 2026-08-31): "Telarchy revenue (USD)", range 0
    // to 1,000, reading $0 every hour, opened its daily market at $499.97.
    // Returning null here is what handed it the midpoint. p=0 is not a price
    // an LMSR can quote, but anchoredMarketState clamps into [0.02, 0.98], so
    // the book opens as low as it can hold instead of in the middle of a range
    // the number is sitting at the bottom of.
    expect(nearHorizonAnchorP('2026-W34', 0, 1000, NOW)).toBe(0);
    expect(nearHorizonAnchorP('2026-W34', 150000, 150000, NOW)).toBe(1);
  });

  test('a value outside the range anchors at the edge it is past, not the middle', () => {
    expect(nearHorizonAnchorP('2026-W34', -20, 1000, NOW)).toBeLessThan(0);
    expect(nearHorizonAnchorP('2026-W34', 1200, 1000, NOW)!).toBeGreaterThan(1);
  });

  test('a non-zero rangeMin is measured from, not assumed away', () => {
    // Manually created markets may carry their own rangeMin.
    expect(nearHorizonAnchorP('2026-W34', 150, 200, NOW, 100)).toBeCloseTo(0.5, 6);
  });

  test('a period already past never anchors', () => {
    expect(nearHorizonAnchorP('2026-07', 10, 100, NOW)).toBeNull();
  });
});
