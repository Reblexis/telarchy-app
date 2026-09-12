/**
 * The ticket's default price guard (docs/ui-conventions.md, "The ticket
 * guards the price by default"): every buy and sell the ticket places may
 * land at most 2% of the book's range past the call its own quote promised,
 * against the trader. The server fills up to that call and hands back the
 * rest (docs/guides/agent-api.md, "Guard the price").
 */

/** How far past its own quote the ticket lets a trade land, as a share of the range. */
export const GUARD_WIDTH = 0.02;

/**
 * Whether a trade pushes the call up: buying higher or selling lower. The
 * same rule as the server's boundSide (functions/src/lib/amm.ts), from the
 * ticket's words.
 */
export function pushesCallUp(tab: 'buy' | 'sell', dir: 'higher' | 'lower'): boolean {
  return tab === 'buy' ? dir === 'higher' : dir === 'lower';
}

/** The limit to send: the quoted landing widened against the trader, or null without a range. */
export function guardLimit(o: { quote: number; rangeMin: number; rangeMax: number; pushesUp: boolean }): number | null {
  const span = o.rangeMax - o.rangeMin;
  if (!(span > 0) || !Number.isFinite(o.quote)) return null;
  return o.quote + (o.pushesUp ? 1 : -1) * GUARD_WIDTH * span;
}
