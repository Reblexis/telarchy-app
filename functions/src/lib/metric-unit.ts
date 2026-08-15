/**
 * What a metric is counted in, read from its name's trailing parenthetical:
 * "LookPilot net 2026 (USD)" is money, "Weekly active verified traders" is
 * not. This convention already decided whether the public page puts a "$"
 * on the headline number; it is shared here because one more decision now
 * depends on it (see below), and two copies of the rule would eventually
 * disagree.
 *
 * Why it is load-bearing (2026-08-15): a conditional pair's approved branch
 * opens at the baseline minus the contract's ask, because approving a $200
 * contract burns $200 out of a revenue metric the day it is paid. That is
 * only true when the metric IS the money. Applied to a metric counted in
 * people, subtracting the ask drove every approved branch to the range floor
 * and printed an identical fake negative impact on every contract in
 * Telarchy's own workspace.
 *
 * The rule is deliberately narrow: a tail naming USD or carrying a "$".
 * Other currencies are not detected, so their metrics anchor unadjusted,
 * which is the safe direction to be wrong in (traders price the burn
 * themselves rather than the platform inventing a move nobody made).
 */
export function metricCurrencyUnit(metricName: string): '$' | '' {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

/** Whether a contract's USD ask is denominated in this metric's own units. */
export function isMonetaryMetric(metricName: string): boolean {
  return metricCurrencyUnit(metricName) !== '';
}
