/**
 * The bet slider's scale (docs/ui-conventions.md, the ticket section).
 *
 * The slider spans 1 cr to the trader's whole balance. Linear, that is
 * useless past a few hundred cr: a 23,000 cr balance puts every bet a
 * sane trader would place inside the leftmost pixels (user report
 * 2026-08-21). The track is logarithmic instead: equal drag multiplies
 * the stake rather than adds to it, so 1..100 cr gets about as much
 * track as 100..10,000.
 *
 * Positions are integers 0..SLIDER_STEPS because a range input wants a
 * fixed step. Dragging snaps the amount to two significant digits so
 * the numeral reads as a chosen stake (150, 1,900) rather than a
 * decoded pixel (1,943). The two ends stay exact: 0 is 1 cr and the
 * top is the full balance, so "all in" is reachable.
 */
export const SLIDER_STEPS = 1000;

export function sliderToAmount(pos: number, maxBet: number): number {
  if (maxBet <= 1) return 1;
  const t = Math.min(SLIDER_STEPS, Math.max(0, pos)) / SLIDER_STEPS;
  if (t >= 1) return maxBet;
  const raw = Math.exp(t * Math.log(maxBet));
  return Math.max(1, Math.min(maxBet, roundToTwoSig(raw)));
}

export function amountToSlider(amount: number, maxBet: number): number {
  if (maxBet <= 1) return SLIDER_STEPS;
  const a = Math.min(maxBet, Math.max(1, amount));
  return Math.round((Math.log(a) / Math.log(maxBet)) * SLIDER_STEPS);
}

function roundToTwoSig(v: number): number {
  if (v < 100) return Math.round(v);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}
