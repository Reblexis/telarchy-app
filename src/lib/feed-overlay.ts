import type { PublicWorkspace } from './api';

/** A branch pair's latest quotes from the feed, by proposal id. */
export type FeedQuotes = Record<string, { approved: number | null; declined: number | null }>;

/**
 * The open step's prices read from the feed (docs/ui-conventions.md, "The
 * feed drives the floor"): a pending proposal the feed names, with ONE
 * pair, shows the feed's latest approved and declined prices and their
 * difference as its impact, so the world cells, the impact chip and the
 * board row move within a feed poll. A decided proposal, one the feed does
 * not name, one priced on several pairs (the feed's number is one
 * horizon's), and a quote with a null side are left exactly as the payload
 * had them. Returns the same object when there is nothing to overlay.
 */
export function overlayFeedQuotes<T extends PublicWorkspace | null>(ws: T, quotes: FeedQuotes): T {
  if (!ws || !ws.proposals || Object.keys(quotes).length === 0) return ws;
  let changed = false;
  const proposals = ws.proposals.map(p => {
    const q = quotes[p.id];
    if (!q || p.status !== 'pending' || p.markets.length !== 1) return p;
    if (typeof q.approved !== 'number' || typeof q.declined !== 'number') return p;
    const m = p.markets[0];
    if (m.approvedConsensus === q.approved && m.declinedConsensus === q.declined) return p;
    changed = true;
    return {
      ...p,
      markets: [{ ...m, approvedConsensus: q.approved, declinedConsensus: q.declined, delta: q.approved - q.declined }],
    };
  });
  return changed ? ({ ...ws, proposals } as T) : ws;
}
