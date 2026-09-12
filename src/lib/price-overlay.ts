import type { FloorPriceBook, PublicProposalOptionQuote, PublicWorkspace } from './api';

/**
 * The once-a-second prices laid over the floor payload (docs/ui-conventions.md,
 * "The floor's live poll"). Every price the floor prints moves in place: a
 * baseline book's consensus, probability and pool; a pending pair's two
 * worlds and their delta; each option's price and every option's lead.
 *
 * Nothing is reordered and nothing that did not change is replaced: an
 * unchanged market, pair, option or proposal comes back as the very same
 * object, and so does the payload when no price moved. A list replaced at a
 * refresh once opened the wrong proposal on a late click
 * (docs/reviews/2026-09-11-snake-design-critic-2.md). A decided proposal is
 * printed as it was ruled on and never repriced here.
 */
export function overlayFloorPrices<T extends PublicWorkspace | null>(
  ws: T,
  books: ReadonlyMap<string, FloorPriceBook> | null | undefined,
): T {
  if (!ws || !books || books.size === 0) return ws;
  let changed = false;

  const markets = ws.markets.map(m => {
    const b = books.get(m.marketId);
    if (!b) return m;
    const probability = b.probability ?? m.probability;
    if (m.consensus === b.consensus && m.probability === probability && m.pool === b.pool) return m;
    changed = true;
    return { ...m, consensus: b.consensus, probability, pool: b.pool };
  });

  let proposalsMoved = false;
  const mapped = ws.proposals?.map(p => {
    if (p.status !== undefined && p.status !== 'pending') return p;
    let touched = false;
    const pairs = p.markets.map(m => {
      if (m.options && m.options.length > 0) {
        let moved = false;
        const options = m.options.map(o => {
          const b = o.marketId ? books.get(o.marketId) : undefined;
          if (!b || (o.consensus === b.consensus && o.probability === b.probability && o.pool === b.pool)) return o;
          moved = true;
          return { ...o, consensus: b.consensus, probability: b.probability, pool: b.pool };
        });
        if (!moved) return m;
        touched = true;
        const { deltas, rowDelta } = optionLeads(options);
        return { ...m, options: options.map(o => ({ ...o, delta: deltas.get(o.id) ?? null })), delta: rowDelta };
      }
      const a = m.approvedMarketId ? books.get(m.approvedMarketId) : undefined;
      const d = m.declinedMarketId ? books.get(m.declinedMarketId) : undefined;
      if (!a && !d) return m;
      const approvedConsensus = a ? a.consensus : m.approvedConsensus;
      const declinedConsensus = d ? d.consensus : m.declinedConsensus;
      const next = {
        ...m,
        approvedConsensus,
        approvedProbability: a ? a.probability : m.approvedProbability,
        approvedPool: a ? a.pool : m.approvedPool,
        declinedConsensus,
        declinedProbability: d ? d.probability : m.declinedProbability,
        declinedPool: d ? d.pool : m.declinedPool,
        delta: approvedConsensus != null && declinedConsensus != null ? approvedConsensus - declinedConsensus : null,
      };
      const same =
        next.approvedConsensus === m.approvedConsensus &&
        next.approvedProbability === m.approvedProbability &&
        next.approvedPool === m.approvedPool &&
        next.declinedConsensus === m.declinedConsensus &&
        next.declinedProbability === m.declinedProbability &&
        next.declinedPool === m.declinedPool &&
        next.delta === m.delta;
      if (same) return m;
      touched = true;
      return next;
    });
    if (!touched) return p;
    changed = true;
    proposalsMoved = true;
    return { ...p, markets: pairs };
  });

  if (!changed) return ws;
  const marketsMoved = markets.some((m, i) => m !== ws.markets[i]);
  return {
    ...ws,
    markets: marketsMoved ? markets : ws.markets,
    proposals: proposalsMoved ? mapped : ws.proposals,
  } as T;
}

/**
 * Each option's lead, as the payload states it (PublicProposalOptionQuote):
 * its consensus minus the best of the other priced options; null for an
 * unpriced option and for every option of a row with fewer than two priced.
 * The row's delta is the leader's lead.
 */
function optionLeads(options: ReadonlyArray<Pick<PublicProposalOptionQuote, 'id' | 'consensus'>>): {
  deltas: Map<string, number | null>;
  rowDelta: number | null;
} {
  const priced = options.filter((o): o is typeof o & { consensus: number } => typeof o.consensus === 'number');
  const deltas = new Map<string, number | null>();
  if (priced.length < 2) return { deltas, rowDelta: null };
  for (const o of priced) {
    const bestOther = Math.max(...priced.filter(x => x.id !== o.id).map(x => x.consensus));
    deltas.set(o.id, o.consensus - bestOther);
  }
  const sorted = priced.map(o => o.consensus).sort((x, y) => y - x);
  return { deltas, rowDelta: sorted[0] - sorted[1] };
}
