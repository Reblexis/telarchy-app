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
 * Granularity is chosen for the sample set as a whole, not per-sample:
 * we pick the coarsest of {day, week, month, year} whose worst-case bucket
 * width is at most the smallest gap between adjacent samples. That makes it
 * impossible for two samples to land in the same — or overlapping — calendar
 * bucket, so we never end up with two markets (e.g. 2026-W23 and 2026-06)
 * that both cover the same day on the same metric.
 */

import type { TimePreference } from '../types';
import { isRelativeDate, periodEndInstant, toAbsoluteDate, toISOWeekString } from './date-utils';

export const WEIGHT_T0 = 1.0; // weight at t = 0 (current)

export const DEFAULT_DENSITY = 3;

export interface TimePoint {
  date: string; // absolute date string (YYYY-MM-DD, YYYY-Www, YYYY-MM, or YYYY)
  weight: number; // probability-mass weight in the exponential distribution
}

export type Granularity = 'day' | 'week' | 'month' | 'year';

const YEAR_DAYS = 365.25;
// Worst-case bucket widths (longest possible calendar period at each granularity).
const MAX_BUCKET_DAYS: Record<Granularity, number> = {
  day: 1,
  week: 7,
  month: 31,
  year: 366,
};

/**
 * Coarsest granularity G such that MAX_BUCKET_DAYS[G] <= minGapDays. Two samples
 * separated by at least the bucket width always cross a calendar boundary, so
 * they cannot share a bucket. The fallback is `day` for very short half-lives;
 * if two samples then collapse to the same day their weights merge below.
 */
export function pickGranularity(timePointsYears: number[]): Granularity {
  if (timePointsYears.length < 2) {
    // Single sample — pick granularity proportional to its own distance.
    const tDays = (timePointsYears[0] ?? 0) * YEAR_DAYS;
    if (tDays >= MAX_BUCKET_DAYS.year) return 'year';
    if (tDays >= MAX_BUCKET_DAYS.month) return 'month';
    if (tDays >= MAX_BUCKET_DAYS.week) return 'week';
    return 'day';
  }
  const sortedDays = timePointsYears.map(t => t * YEAR_DAYS).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < sortedDays.length; i++) {
    const gap = sortedDays[i] - sortedDays[i - 1];
    if (gap < minGap) minGap = gap;
  }
  if (minGap >= MAX_BUCKET_DAYS.year) return 'year';
  if (minGap >= MAX_BUCKET_DAYS.month) return 'month';
  if (minGap >= MAX_BUCKET_DAYS.week) return 'week';
  return 'day';
}

function dateAtGranularity(years: number, base: Date, granularity: Granularity): string {
  const days = Math.max(1, Math.round(years * YEAR_DAYS));
  const d = new Date(base);
  d.setDate(d.getDate() + days);

  switch (granularity) {
    case 'day':
      return d.toISOString().slice(0, 10);
    case 'week':
      return toISOWeekString(d);
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'year':
      return String(d.getFullYear());
  }
}

/**
 * Return up to N quantile-midpoint time points for a given halfLife at a single
 * granularity. If two samples map to the same bucket (only possible when the
 * gap is smaller than 1 day, i.e. very short half-life + high density), their
 * weights merge so the bucket reflects the probability mass it represents.
 */
export function sampleTimePoints(halfLife: number, density?: number, base: Date = new Date()): TimePoint[] {
  const n = Math.max(1, Math.floor(density ?? DEFAULT_DENSITY));
  const lambda = Math.LN2 / halfLife;

  const ts: number[] = [];
  for (let i = 1; i <= n; i++) {
    const p = (2 * i - 1) / (2 * n);
    ts.push(-Math.log(1 - p) / lambda);
  }

  const granularity = pickGranularity(ts);

  const buckets = new Map<string, number>();
  for (const tYears of ts) {
    const date = dateAtGranularity(tYears, base, granularity);
    buckets.set(date, (buckets.get(date) ?? 0) + 1.0);
  }

  return Array.from(buckets, ([date, weight]) => ({ date, weight }));
}

/**
 * Resolve a metric's custom horizon entries to absolute date strings.
 *
 * Relative entries ("+3m") are rolling: re-resolved against `base` on every
 * call, so the desired set advances as time passes. Absolute entries are
 * one-shot: kept verbatim until their period has fully passed, then dropped.
 * Defensive on historical jsonb: non-arrays and non-string entries are ignored.
 */
export function resolveCustomHorizons(horizons: unknown, base: Date = new Date()): string[] {
  if (!Array.isArray(horizons)) return [];
  const out = new Set<string>();
  for (const entry of horizons) {
    if (typeof entry !== 'string') continue;
    const raw = entry.trim();
    if (!raw) continue;
    const date = isRelativeDate(raw) ? toAbsoluteDate(raw, base) : raw;
    if (periodEndInstant(date) <= base) continue; // period fully passed, nothing to trade
    out.add(date);
  }
  return Array.from(out);
}

/**
 * The full set of market dates a TP config wants right now: exponential curve
 * samples (when enabled) union resolved custom horizons. One `base` is threaded
 * into both generators so the two halves never disagree about "today".
 * Sorted chronologically by period end for stable ordering downstream.
 */
export function desiredMarketDates(tp: TimePreference, base: Date = new Date()): string[] {
  const dates = new Set<string>(tp.enabled ? sampleTimePoints(tp.halfLife, tp.density, base).map(p => p.date) : []);
  for (const date of resolveCustomHorizons(tp.customHorizons, base)) dates.add(date);
  return Array.from(dates).sort((a, b) => periodEndInstant(a).getTime() - periodEndInstant(b).getTime());
}

/**
 * Whether this TP config makes the metric's markets system-managed: the curve
 * is enabled, or at least one custom horizon is currently effective (unexpired).
 */
export function generatesMarkets(tp: TimePreference | null | undefined, base: Date = new Date()): tp is TimePreference {
  if (!tp) return false;
  return tp.enabled || resolveCustomHorizons(tp.customHorizons, base).length > 0;
}

/**
 * BFS from a metric to collect all leaf descendants.
 * A leaf is a metric with no formula (formula === '0' or '').
 * Does not include the starting metric itself.
 */
export function getLeafDescendantNames(metricName: string, nameToFormula: Record<string, string>): string[] {
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
