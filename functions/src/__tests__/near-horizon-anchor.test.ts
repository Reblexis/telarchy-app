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

  test('refuses to anchor without a usable value or inside the range', () => {
    expect(nearHorizonAnchorP('2026-W34', null, 150000, NOW)).toBeNull();
    expect(nearHorizonAnchorP('2026-W34', NaN, 150000, NOW)).toBeNull();
    // At or beyond the range edges there is no probability to open at.
    expect(nearHorizonAnchorP('2026-W34', 0, 150000, NOW)).toBeNull();
    expect(nearHorizonAnchorP('2026-W34', 150000, 150000, NOW)).toBeNull();
    expect(nearHorizonAnchorP('2026-W34', 45338.94, 0, NOW)).toBeNull();
  });

  test('a period already past never anchors', () => {
    expect(nearHorizonAnchorP('2026-07', 10, 100, NOW)).toBeNull();
  });
});
