/**
 * What a floor URL's hash points at (docs/ui-conventions.md, "A trade has an
 * address"): a proposal (the older `contract=` spelling is still printed in
 * emails already sent), a comment in its thread, a market to step the page
 * to, and a trade to open the Activity tab on and flash. Null when the hash
 * names none of them, so `#account` and friends pass through untouched.
 */
export interface FloorHash {
  proposal: string | null;
  comment: string | null;
  market: string | null;
  trade: string | null;
}

export function parseFloorHash(hash: string): FloorHash | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const out: FloorHash = {
    proposal: params.get('proposal') ?? params.get('contract'),
    comment: params.get('comment'),
    market: params.get('market'),
    trade: params.get('trade'),
  };
  if (!out.proposal && !out.comment && !out.market && !out.trade) return null;
  return out;
}

/** The address of a market, a proposal, or one trade on a floor. */
export function floorHref(
  workspaceSlug: string,
  target: { marketId?: string | null; proposalId?: string | null; tradeId?: string | null },
): string {
  const params: string[] = [];
  if (target.proposalId) params.push(`proposal=${encodeURIComponent(target.proposalId)}`);
  else if (target.marketId) params.push(`market=${encodeURIComponent(target.marketId)}`);
  if (target.tradeId) params.push(`trade=${encodeURIComponent(target.tradeId)}`);
  const base = `/${encodeURIComponent(workspaceSlug)}`;
  return params.length ? `${base}#${params.join('&')}` : base;
}
