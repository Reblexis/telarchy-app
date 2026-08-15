import { AMM_DEFAULTS } from './amm';
import { periodEndInstant } from './date-utils';

/**
 * Where a fresh baseline market should open, as a probability across its
 * range, or null to keep the range midpoint (2026-08-15).
 *
 * A near horizon opens at the metric's own current value: over a week the
 * number cannot travel far, so opening at the midpoint is not a forecast,
 * it is an arithmetic error that hands credits to whoever reads the metric
 * first (LookPilot's weekly market opened at $75,000 against a live
 * $45,339). Past the window the midpoint stands, because a year out
 * today's reading genuinely is not an estimate of the settle value, and
 * the operator re-anchors those with a published trade instead.
 */
export const NEAR_HORIZON_DAYS = 45;

export function nearHorizonAnchorP(
  targetDate: string,
  value: number | null | undefined,
  rangeMax: number,
  now: Date = new Date(),
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const end = periodEndInstant(targetDate)?.getTime();
  if (!end || !Number.isFinite(end)) return null;
  const daysOut = (end - now.getTime()) / 86_400_000;
  if (daysOut <= 0 || daysOut > NEAR_HORIZON_DAYS) return null;
  const span = rangeMax - AMM_DEFAULTS.rangeMin;
  if (span <= 0) return null;
  const p = (value - AMM_DEFAULTS.rangeMin) / span;
  return p > 0 && p < 1 ? p : null;
}
