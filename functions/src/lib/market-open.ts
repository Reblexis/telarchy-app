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
 *
 * A value AT or BEYOND a range edge still anchors (owner report 2026-08-31).
 * It used to return null there, on the reasoning that p=0 is not a
 * probability, and the midpoint that replaced it was the worst answer
 * available: "Telarchy revenue (USD)", range 0 to 1,000 and reading $0 every
 * hour, opened its daily market at $499.97. An LMSR cannot quote certainty,
 * but `anchoredMarketState` already clamps into [0.02, 0.98], so the honest
 * open is the lowest price the book can hold, not the middle of a range the
 * number is sitting at the bottom of. The clamp lives there and only there,
 * so this function returns the raw position and callers do not each pick an
 * epsilon.
 */
export const NEAR_HORIZON_DAYS = 45;

export function nearHorizonAnchorP(
  targetDate: string,
  value: number | null | undefined,
  rangeMax: number,
  now: Date = new Date(),
  rangeMin: number = AMM_DEFAULTS.rangeMin,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const end = periodEndInstant(targetDate)?.getTime();
  if (!end || !Number.isFinite(end)) return null;
  const daysOut = (end - now.getTime()) / 86_400_000;
  if (daysOut <= 0 || daysOut > NEAR_HORIZON_DAYS) return null;
  const span = rangeMax - rangeMin;
  if (span <= 0) return null;
  return (value - rangeMin) / span;
}
