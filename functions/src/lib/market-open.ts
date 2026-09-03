import { AMM_DEFAULTS } from './amm';
import { periodEndInstant } from './date-utils';

/**
 * Where a fresh baseline market should open, as a probability across its
 * range, or null when there is no measured value to open at (2026-08-15,
 * horizon window removed 2026-08-31).
 *
 * A market opens at the metric's own current value, however far out it
 * settles. Opening at the midpoint is not a forecast: it is an artifact of
 * the range the operator happened to choose, and it hands credits to
 * whoever reads the metric first (LookPilot's weekly market opened at
 * $75,000 against a live $45,339).
 *
 * The window this function used to apply (45 days, beyond which the
 * midpoint stood) rested on the idea that today's reading is not an
 * estimate of next December. True, and beside the point: the midpoint is
 * not an estimate of anything at all, it just inherits whatever ceiling
 * the operator typed. The measured value is the only number in the system
 * that was actually observed, and it carries the scale and the direction of
 * travel that the middle of an arbitrary band does not. Depth settles the
 * argument: a deep pool is exactly what makes a wrong opening price
 * expensive to correct, so the markets that most deserve a subsidy are the
 * ones that can least afford a midpoint open (owner rule 2026-08-31, after
 * a December revenue market carrying 2,000 credits opened at $4,500 against
 * a measured $3,470).
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
 *
 * A period that has already ended still returns null: there is no forecast
 * left to place, only a resolution waiting to happen.
 */
export function openingAnchorP(
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
  if (daysOut <= 0) return null;
  const span = rangeMax - rangeMin;
  if (span <= 0) return null;
  return (value - rangeMin) / span;
}

/**
 * Where a fresh baseline market opens when the metric already has a traded
 * open baseline book: at the price of the traded book whose settlement is
 * nearest the new one's, or null when there is none (then the reading
 * governs, `openingAnchorP`). Docs: docs/ui-conventions.md, "Where markets
 * open". The reading is the past; a traded sibling is the market's own
 * forecast of the same number and the only price on the floor anyone has
 * paid for. A period that has already ended still returns null.
 */
export function siblingAnchorP(
  targetDate: string,
  siblings: Array<{ targetDate: string; price: number | null }>,
  rangeMax: number,
  now: Date = new Date(),
  rangeMin: number = AMM_DEFAULTS.rangeMin,
): number | null {
  const end = periodEndInstant(targetDate)?.getTime();
  if (!end || !Number.isFinite(end)) return null;
  if (end - now.getTime() <= 0) return null;
  const span = rangeMax - rangeMin;
  if (span <= 0) return null;
  let best: { distance: number; price: number } | null = null;
  for (const s of siblings) {
    if (typeof s.price !== 'number' || !Number.isFinite(s.price)) continue;
    const sEnd = periodEndInstant(s.targetDate)?.getTime();
    if (!sEnd || !Number.isFinite(sEnd)) continue;
    const distance = Math.abs(sEnd - end);
    if (best === null || distance < best.distance) best = { distance, price: s.price };
  }
  if (best === null) return null;
  return (best.price - rangeMin) / span;
}
