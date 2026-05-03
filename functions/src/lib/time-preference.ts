/**
 * Time Preference System — sampling and leaf-discovery utilities.
 *
 * A time-preferenced metric node has an exponential decay function:
 *   f(t) = λe^(-λt)  where λ = ln(2) / halfLife
 *
 * We sample N quantile-midpoints of this distribution (default N=3).
 * Each bin covers equal probability mass, so all sample points receive
 * equal weight (1.0) in the weighted average.
 *
 *   p_i = (2i − 1) / (2N)   for i = 1..N
 *   t_i = (−ln(1 − p_i)) / λ
 *
 * Date granularity by distance:
 *   < 1 week  → YYYY-MM-DD (day)
 *   < 1 month → YYYY-Www   (week)
 *   < 1 year  → YYYY-MM    (month)
 *   ≥ 1 year  → YYYY       (year)
 */

import { toISOWeekString } from './date-utils';

export const WEIGHT_T0 = 1.0; // weight at t = 0 (current)

export const DEFAULT_DENSITY = 3;

export interface TimePoint {
  date: string;   // absolute date string (YYYY-MM or YYYY)
  weight: number; // e^(-λt) pre-computed
}

function fractionalYearsToDate(years: number, base: Date): string {
  const days = Math.max(1, Math.round(years * 365));
  const d = new Date(base);
  d.setDate(d.getDate() + days);

  if (years < 7 / 365) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (years < 1 / 12) {
    return toISOWeekString(d); // YYYY-Www
  }
  if (years < 1) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
  }
  return String(d.getFullYear()); // YYYY
}

/**
 * Return N quantile-midpoint time points for a given halfLife.
 * Deduplicates dates that collapse to the same period.
 */
export function sampleTimePoints(halfLife: number, density?: number, base: Date = new Date()): TimePoint[] {
  const n = Math.max(1, Math.floor(density ?? DEFAULT_DENSITY));
  const seen = new Set<string>();
  const result: TimePoint[] = [];
  const lambda = Math.LN2 / halfLife;

  for (let i = 1; i <= n; i++) {
    const p = (2 * i - 1) / (2 * n);
    const tYears = (-Math.log(1 - p)) / lambda;
    const date = fractionalYearsToDate(tYears, base);
    if (!seen.has(date)) {
      seen.add(date);
      result.push({ date, weight: 1.0 });
    }
  }

  return result;
}

/**
 * BFS from a metric to collect all leaf descendants.
 * A leaf is a metric with no formula (formula === '0' or '').
 * Does not include the starting metric itself.
 */
export function getLeafDescendantNames(
  metricName: string,
  nameToFormula: Record<string, string>,
): string[] {
  const formula = nameToFormula[metricName];
  if (!formula || formula.trim() === '0') return [];

  const leaves = new Set<string>();
  const visited = new Set<string>([metricName]);
  const queue: string[] = [];

  // Seed with direct refs
  const directRefs = formula.match(/\{([^}]+)\}/g) ?? [];
  for (const ref of directRefs) {
    const name = ref.slice(1, -1).trim();
    if (!visited.has(name)) {
      visited.add(name);
      queue.push(name);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const childFormula = nameToFormula[current];
    if (!childFormula || childFormula.trim() === '0') {
      leaves.add(current);
    } else {
      const refs = childFormula.match(/\{([^}]+)\}/g) ?? [];
      for (const ref of refs) {
        const name = ref.slice(1, -1).trim();
        if (!visited.has(name)) {
          visited.add(name);
          queue.push(name);
        }
      }
    }
  }

  return Array.from(leaves);
}
