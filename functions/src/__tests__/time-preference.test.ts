import { pickGranularity, sampleTimePoints } from '../lib/time-preference';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_PATTERN = /^\d{4}-W\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;

describe('pickGranularity', () => {
  test('returns day when min gap < 7 days', () => {
    expect(pickGranularity([5 / 365.25, 11 / 365.25])).toBe('day');
  });
  test('returns week when 7 <= min gap < 31 days', () => {
    expect(pickGranularity([0, 10 / 365.25])).toBe('week');
    expect(pickGranularity([0, 30 / 365.25])).toBe('week');
  });
  test('returns month when 31 <= min gap < 366 days', () => {
    expect(pickGranularity([0, 60 / 365.25])).toBe('month');
    expect(pickGranularity([0, 365 / 365.25])).toBe('month');
  });
  test('returns year when min gap >= 366 days', () => {
    expect(pickGranularity([0, 2])).toBe('year');
  });
  test('single sample picks granularity by its own distance', () => {
    expect(pickGranularity([1 / 365.25])).toBe('day');
    expect(pickGranularity([15 / 365.25])).toBe('week');
    expect(pickGranularity([90 / 365.25])).toBe('month');
    expect(pickGranularity([5])).toBe('year');
  });
});

describe('sampleTimePoints', () => {
  test('the lookpilot Steam-revenue case (halfLife≈14d, density=5) emits 5 distinct day buckets — no week/month overlap', () => {
    // Previously this configuration emitted 2026-W23 + 2026-06 with both pointing
    // at the same calendar day, double-counting that day in the outlook and
    // producing the 7320.39 vs visible-markets-below mismatch reported in prod.
    const halfLife = 14 / 365.25;
    const base = new Date(Date.UTC(2026, 4, 13)); // 2026-05-13
    const points = sampleTimePoints(halfLife, 5, base);
    expect(points.length).toBe(5);
    for (const p of points) {
      expect(p.date).toMatch(DAY_PATTERN);
      expect(p.weight).toBe(1.0);
    }
    const labels = new Set(points.map(p => p.date));
    expect(labels.size).toBe(5);
  });

  test('halfLife=14d, density=3 picks week granularity (min gap ≈ 10 days)', () => {
    const halfLife = 14 / 365.25;
    const base = new Date(Date.UTC(2026, 4, 13));
    const points = sampleTimePoints(halfLife, 3, base);
    expect(points.length).toBe(3);
    for (const p of points) expect(p.date).toMatch(WEEK_PATTERN);
  });

  test('halfLife=1y, density=10 picks month granularity', () => {
    const points = sampleTimePoints(1, 10, new Date(Date.UTC(2026, 0, 1)));
    expect(points.length).toBeGreaterThanOrEqual(9); // allow at-most-one merge at the head
    for (const p of points) expect(p.date).toMatch(MONTH_PATTERN);
    expect(new Set(points.map(p => p.date)).size).toBe(points.length);
  });

  test('halfLife=5y, density=5 picks year granularity', () => {
    const points = sampleTimePoints(5, 5, new Date(Date.UTC(2026, 0, 1)));
    expect(points.length).toBe(5);
    for (const p of points) expect(p.date).toMatch(YEAR_PATTERN);
    expect(new Set(points.map(p => p.date)).size).toBe(5);
  });

  test('all samples for a single (halfLife, density) share one granularity', () => {
    const halfLife = 14 / 365.25;
    const base = new Date(Date.UTC(2026, 4, 13));
    const cases: Array<[number, number]> = [
      [halfLife, 3],
      [halfLife, 5],
      [0.5, 5],
      [1, 10],
      [5, 5],
    ];
    for (const [hl, density] of cases) {
      const points = sampleTimePoints(hl, density, base);
      const granularities = new Set(
        points.map(p => {
          if (DAY_PATTERN.test(p.date)) return 'day';
          if (WEEK_PATTERN.test(p.date)) return 'week';
          if (MONTH_PATTERN.test(p.date)) return 'month';
          if (YEAR_PATTERN.test(p.date)) return 'year';
          return 'unknown';
        }),
      );
      expect(granularities.size).toBe(1);
    }
  });

  test('weights merge when samples collide on the same bucket', () => {
    // Sub-day half-life with high density forces multiple samples onto the same
    // day — the bucket weight should sum so the outlook average preserves the
    // total probability mass of the exponential distribution.
    const halfLife = 0.5 / 365.25; // half a day
    const points = sampleTimePoints(halfLife, 5, new Date(Date.UTC(2026, 4, 13)));
    const totalWeight = points.reduce((s, p) => s + p.weight, 0);
    expect(totalWeight).toBe(5);
  });
});
