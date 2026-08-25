import { periodEndInstant } from './date-utils';

/**
 * The one ordering of a floor's baseline markets: SOONEST-FIRST, with the
 * primary (the furthest-resolving market, the headline everywhere a single
 * number is shown) as the LAST element.
 *
 * Ties on the settle instant are real now that a floor prices several metrics
 * on the same three dates (owner ask 2026-08-25, docs/ui-conventions.md "Two
 * steppers"). Liquidity broke the tie before, which was harmless with one
 * metric per date and would let a trade flip the headline with two. The tie
 * goes to the metric with the LOWER `order` (the owner sets it with
 * POST /api/metrics/reorder, floor metric first), then the earlier name, then
 * the market id, so the rule is total and the client mirror
 * (`primaryHorizonOf` in src/lib/floor-horizons.ts) can compute the same
 * answer from the payload alone.
 */
export interface BaselineOrderKey {
  targetDate: string;
  metricName: string;
  /** Missing on a payload that predates the field: sorts as last (999). */
  metricOrder?: number | null;
  marketId?: string;
}

const LAST = 999;

export function compareSoonestFirst(a: BaselineOrderKey, b: BaselineOrderKey): number {
  const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
  if (dateDiff !== 0) return dateDiff;
  // Lower order is the primary, and the primary goes LAST in a soonest-first
  // list, so higher order sorts earlier.
  const orderDiff = (b.metricOrder ?? LAST) - (a.metricOrder ?? LAST);
  if (orderDiff !== 0) return orderDiff;
  if (a.metricName !== b.metricName) return a.metricName < b.metricName ? 1 : -1;
  const ai = a.marketId ?? '';
  const bi = b.marketId ?? '';
  return ai === bi ? 0 : ai < bi ? 1 : -1;
}

/**
 * Which of a workspace's open markets is THE number: the furthest-resolving
 * one (owner direction 2026-08-16), the last element of a soonest-first list.
 */
export function primaryOf<T>(soonestFirst: T[]): T | undefined {
  return soonestFirst.length > 0 ? soonestFirst[soonestFirst.length - 1] : undefined;
}
