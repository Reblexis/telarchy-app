import type { PublicWorkspace } from './api';

/** A branch pair's latest quotes from the feed. */
export type PairFeedQuote = { approved: number | null; declined: number | null };
/** A proposal with options' latest quotes from the feed: each option's price
 *  (its consensus) and lead (its consensus minus the best other option). */
export type OptionFeedQuote = { options: Record<string, { price: number | null; lead: number | null }> };
/** The feed's quotes by proposal id, in whichever shape the proposal has. */
export type FeedQuotes = Record<string, PairFeedQuote | OptionFeedQuote>;

const isOptionQuote = (q: PairFeedQuote | OptionFeedQuote): q is OptionFeedQuote =>
  typeof (q as OptionFeedQuote).options === 'object' && (q as OptionFeedQuote).options !== null;

/**
 * The open step's prices read from the feed (docs/ui-conventions.md, "The
 * feed drives the floor"): a pending proposal the feed names, with ONE
 * row, shows the feed's latest prices so the world cells, the impact and
 * the board row move within a feed poll. A pair takes the approved and
 * declined prices and their difference; a proposal with options takes each
 * option's price as its consensus and its lead as its delta, and the row's
 * delta is the leader's lead over the next best, none with fewer than two
 * priced (docs/guides/proposals.md, "More than two options"). A decided
 * proposal, one the feed does not name, one priced on several rows (the
 * feed's number is one horizon's), a quote of the other shape, and a pair
 * quote with a null side are left exactly as the payload had them. Returns
 * the same object when there is nothing to overlay.
 */
export function overlayFeedQuotes<T extends PublicWorkspace | null>(ws: T, quotes: FeedQuotes): T {
  if (!ws || !ws.proposals || Object.keys(quotes).length === 0) return ws;
  let changed = false;
  const proposals = ws.proposals.map(p => {
    const q = quotes[p.id];
    if (!q || p.status !== 'pending' || p.markets.length !== 1) return p;
    const m = p.markets[0];
    const optionRow = !!m.options && m.options.length > 0;
    if (isOptionQuote(q)) {
      if (!optionRow || !m.options) return p;
      const options = m.options.map(o => {
        const f = q.options[o.id];
        if (!f || typeof f.price !== 'number') return o;
        return { ...o, consensus: f.price, delta: typeof f.lead === 'number' ? f.lead : null };
      });
      const prices = m.options
        .map(o => q.options[o.id]?.price)
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => b - a);
      const delta = prices.length >= 2 ? prices[0] - prices[1] : null;
      const same = delta === m.delta && options.every((o, i) => o === m.options?.[i] || sameQuote(o, m.options?.[i]));
      if (same) return p;
      changed = true;
      return { ...p, markets: [{ ...m, options, delta }] };
    }
    if (optionRow) return p;
    if (typeof q.approved !== 'number' || typeof q.declined !== 'number') return p;
    if (m.approvedConsensus === q.approved && m.declinedConsensus === q.declined) return p;
    changed = true;
    return {
      ...p,
      markets: [{ ...m, approvedConsensus: q.approved, declinedConsensus: q.declined, delta: q.approved - q.declined }],
    };
  });
  return changed ? ({ ...ws, proposals } as T) : ws;
}

function sameQuote(
  a: { consensus: number | null; delta: number | null },
  b: { consensus: number | null; delta: number | null } | undefined,
): boolean {
  return !!b && a.consensus === b.consensus && a.delta === b.delta;
}
