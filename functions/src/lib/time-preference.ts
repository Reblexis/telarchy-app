/**
 * Time Preference System — sampling and leaf-discovery utilities.
 *
 * A time-preferenced metric node has an exponential decay function:
 *   weight(t) = e^(-λt)  where λ = ln(2) / halfLife
 *
 * We sample at 4 fixed multiples of the half-life:
 *   0.25×, 0.5×, 1×, 2×  (plus t=0 which always uses current values)
 *
 * Weights at those multipliers are always 2^(-0.25), 2^(-0.5), 2^(-1), 2^(-2)
 * regardless of halfLife, because the multipliers are in units of halfLife.
 */

export const WEIGHT_T0 = 1.0; // weight at t = 0 (current)

// Fixed sample multipliers (multiples of halfLife)
const SAMPLE_MULTIPLIERS = [0.25, 0.5, 1.0, 2.0];

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
  if (years < 2) {
    const monthsToAdd = Math.max(1, Math.round(years * 12));
    const d = new Date(base);
    d.setMonth(d.getMonth() + monthsToAdd);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return String(base.getFullYear() + Math.round(years));
}

/**
 * Return the time points (date + weight) to sample for a given halfLife.
 * Deduplicates dates that map to the same period.
 */
export function sampleTimePoints(halfLife: number, base: Date = new Date()): TimePoint[] {
  const seen = new Set<string>();
  const result: TimePoint[] = [];

  for (const m of SAMPLE_MULTIPLIERS) {
    const tYears = m * halfLife;
    const weight = Math.pow(2, -m);
    const date = fractionalYearsToDate(tYears, base);
    if (!seen.has(date)) {
      seen.add(date);
      result.push({ date, weight });
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
