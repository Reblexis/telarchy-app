/**
 * Which conditional pairs a reader is shown, and why it is one rule.
 *
 * A pair is voided when its horizon is retired: the market stops trading and
 * everyone is refunded, but the LMSR shares stay, so `consensus()` keeps
 * returning the last price it ever had. On a proposal nobody has decided that
 * price is dead weight - it answers a question the floor no longer asks, while
 * looking exactly like a live forecast (seen 2026-08-15, when the near horizon
 * moved to a weekly cadence and every proposal kept printing its old monthly
 * number). On a DECIDED proposal the same rows are the record of what was
 * priced when the owner ruled, so they stay.
 *
 * The ballot learned this in August 2026 and the brief did not, which is how
 * the floor's own market maker came to recommend a proposal on a +11.79 the
 * page beside him refused to show (notes/otto-brief-misread-2026-08-31.md).
 * The rule lives here now so the next reader inherits it instead of
 * rediscovering it.
 */

/** True where a proposal's voided pairs are its record rather than its forecast. */
export function keepsVoidedPairs(proposalStatus: string): boolean {
  return proposalStatus !== 'pending';
}

/**
 * Whether one branch market belongs in what a reader is shown for this
 * proposal. Branch-level, not pair-level, because that is the grain the
 * ballot filters at and two readers applying the rule at different grains is
 * how they diverge again.
 */
export function branchIsShown(proposalStatus: string, voided: boolean): boolean {
  return !voided || keepsVoidedPairs(proposalStatus);
}

/**
 * Whether a horizon has already resolved, i.e. whether its price is history
 * rather than a forecast. `resolvesOn` is the instant the market settles on;
 * a target date the calendar cannot place has no instant and is never called
 * settled, because guessing there would retire a live horizon.
 */
export function horizonSettled(resolvesOn: string | null, now: Date = new Date()): boolean {
  if (!resolvesOn) return false;
  const at = Date.parse(resolvesOn);
  return Number.isFinite(at) && at <= now.getTime();
}
