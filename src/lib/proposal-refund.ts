/**
 * The one fact of a proposal's mechanism a trader needs before pressing: a
 * bet on the world that does not happen is refunded at cost
 * (docs/ui-conventions.md, "A proposal is a decision with a price": the single
 * exception to "the mechanism is never explained above the trade"). Null once
 * the proposal is decided or lapsed, because the ruling has already happened.
 */
export function refundLine(p: { pending: boolean; optioned: boolean; branch: string }): string | null {
  if (!p.pending) return null;
  if (p.optioned) return 'If another option is chosen, your bet is refunded.';
  return p.branch === 'declined'
    ? 'If this is approved, your bet is refunded.'
    : 'If this is declined, your bet is refunded.';
}
