/**
 * One in-process signal: "prices on this market just changed".
 *
 *   trade insert ──┐
 *   liquidity ─────┼─▶ emitPricesChanged(ws, market, { moneyMoved }) ─▶ every listener
 *   injection ─────┘         (services emit)                            (caches invalidate)
 *
 * Exists so the price-facing TTL caches (the floor payload in
 * routes/marketplace.ts, the history replay in services/predictions.ts) can
 * drop their entries the moment a mutation lands, without the services that
 * write trades importing the routes that cache them (that import direction
 * would be circular). Emitting inside a transaction that later rolls back
 * costs one spurious cache miss, which is harmless; listeners must stay
 * cheap and synchronous.
 *
 * `moneyMoved` says whether anybody's money moved with the price: a trade, a
 * resolution, the void of a book somebody traded. A new book, a proposal's
 * funding, trading closing or the void of an untraded book moves prices only,
 * and must say so: the leaderboard is emptied only when money moved
 * (docs/infra/deploy.md, "Prices, one channel across instances"), and a
 * machine-run floor opens and closes books every second. Unsaid means it did.
 */

/** Where a change was made: on this instance, or on another one that said so
 *  over the price channel (lib/price-channel.ts). */
export type PriceChangeOrigin = 'local' | 'remote';

export interface PriceChange {
  moneyMoved: boolean;
}

type Listener = (workspaceId: string, marketId?: string, origin?: PriceChangeOrigin, change?: PriceChange) => void;

const listeners: Listener[] = [];

export function onPricesChanged(fn: Listener): void {
  listeners.push(fn);
}

export function emitPricesChanged(workspaceId: string, marketId?: string, change: Partial<PriceChange> = {}): void {
  fanOut(workspaceId, marketId, 'local', { moneyMoved: change.moneyMoved ?? true });
}

/** A change another instance committed, heard on the price channel. */
export function emitRemotePricesChanged(
  workspaceId: string,
  marketId?: string,
  change: Partial<PriceChange> = {},
): void {
  fanOut(workspaceId, marketId, 'remote', { moneyMoved: change.moneyMoved ?? true });
}

function fanOut(
  workspaceId: string,
  marketId: string | undefined,
  origin: PriceChangeOrigin,
  change: PriceChange,
): void {
  for (const fn of listeners) {
    try {
      fn(workspaceId, marketId, origin, change);
    } catch (e) {
      console.error('price listener failed:', e);
    }
  }
}
