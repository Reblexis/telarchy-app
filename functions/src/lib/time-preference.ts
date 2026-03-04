/**
 * Time Preference System — sampling and leaf-discovery utilities.
 *
 * A time-preferenced metric node has an exponential decay function:
 *   f(t) = λe^(-λt)  where λ = ln(2) / halfLife
 *
 * We sample 10 quantile-midpoints of this distribution.
 * Each bin covers equal probability mass, so all sample points receive
 * equal weight (1.0) in the weighted average.
 *
 *   p_i = (2i − 1) / 20   for i = 1..10  →  [0.05, 0.15, …, 0.95]
 *   t_i = (−ln(1 − p_i)) / λ
 *
 * Dates are formatted with day/month/year granularity depending on distance.
 */

export const WEIGHT_T0 = 1.0; // weight at t = 0 (current)

const N_SAMPLES = 10;

export interface TimePoint {
  date: string;   // absolute date string (YYYY-MM or YYYY)
  weight: number; // e^(-λt) pre-computed
}

/**
 * Convert a fractional year offset to an absolute date string.
 * < 2 years → YYYY-MM (month granularity)
 * ≥ 2 years → YYYY   (year granularity)
 */
function fractionalYearsToDate(years: number, base: Date): string {
  const daysTotal = Math.max(1, Math.round(years * 365));
  if (years < 1 / 12) {
    // Day granularity for < ~1 month
    const d = new Date(base);
    d.setDate(d.getDate() + daysTotal);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (years < 2) {
    const monthsToAdd = Math.max(1, Math.round(years * 12));
    const d = new Date(base);
    d.setMonth(d.getMonth() + monthsToAdd);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return String(base.getFullYear() + Math.round(years));
}

/**
 * Return 10 quantile-midpoint time points for a given halfLife.
 * Deduplicates dates that collapse to the same period.
 */
export function sampleTimePoints(halfLife: number, base: Date = new Date()): TimePoint[] {
  const seen = new Set<string>();
  const result: TimePoint[] = [];
  const lambda = Math.LN2 / halfLife;

  for (let i = 1; i <= N_SAMPLES; i++) {
    const p = (2 * i - 1) / (2 * N_SAMPLES);
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
