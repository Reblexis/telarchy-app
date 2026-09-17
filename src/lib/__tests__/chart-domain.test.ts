import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { priceBand } from '../chart-domain';

// A book that lived between 6 and 21 (the owner's chart, 2026-09-17).
const LIVED = [
  20, 19.8, 19.8, 17.8, 13, 13, 12.8, 20.2, 19.8, 19.5, 18, 18.2, 19, 18.5, 17, 17, 21, 17.8, 13, 7, 6.2, 6.2, 9, 7,
];
const THIN = Array.from({ length: 40 }, (_, i) => 73_000 + ((i * 7) % 5) * 1000);

describe('priceBand: every price in the window is shown, only a freak print is cut', () => {
  it('THE HIGHEST AND THE LOWEST PRICE ARE BOTH INSIDE THE BAND', () => {
    const [lo, hi] = priceBand([...LIVED, 27, 3], [17]);
    expect(lo).toBe(3);
    expect(hi).toBe(27);
  });

  it('reaches past the 5th..95th percentile band by at most the band itself, each side', () => {
    const [lo, hi] = priceBand([...THIN.slice(0, 20), 180_000, 10, ...THIN.slice(20)], [75_000]);
    // Percentile band is 73k..77k (4k high), so the reach ends at 69k and 81k.
    expect(lo).toBe(69_000);
    expect(hi).toBe(81_000);
  });

  it('never cuts a must-show value (the live call, a ghost, an order)', () => {
    const [lo, hi] = priceBand(THIN, [180_000, 5]);
    expect(lo).toBe(5);
    expect(hi).toBe(180_000);
  });

  it('does not reach beyond the data: a quiet book keeps its own min and max', () => {
    expect(priceBand([10, 11, 12], [11])).toEqual([10, 12]);
  });

  it('one value, equal values, negatives and an empty series', () => {
    expect(priceBand([5], [5])).toEqual([5, 5]);
    expect(priceBand([5, 5, 5], [5])).toEqual([5, 5]);
    expect(priceBand([-20, -19, -18, -30], [-19])).toEqual([-30, -18]);
    expect(priceBand([], [7])).toEqual([7, 7]);
    expect(priceBand([], [])).toEqual([0, 0]);
  });

  it('ignores values that are not finite numbers', () => {
    expect(priceBand([1, Number.NaN, 3, Number.POSITIVE_INFINITY], [2])).toEqual([1, 3]);
  });
});

describe('one rule, one place', () => {
  it('no other frontend file computes its own percentile band', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(f => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
        return /\.tsx?$/.test(f) ? [p] : [];
      });
    const offenders = walk(join(__dirname, '..', '..')).filter(
      p => !p.endsWith('chart-domain.ts') && /quantile\(0\.\d+\)/.test(readFileSync(p, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
