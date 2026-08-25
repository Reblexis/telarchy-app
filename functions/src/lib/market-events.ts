/**
 * One in-process signal: "prices on this market just changed".
 *
 *   trade insert ──┐
 *   liquidity ─────┼─▶ emitPricesChanged(ws, market) ─▶ every listener
 *   injection ─────┘         (services emit)             (caches invalidate)
 *
 * Exists so the price-facing TTL caches (the floor payload in
 * routes/marketplace.ts, the history replay in services/predictions.ts) can
 * drop their entries the moment a mutation lands, without the services that
 * write trades importing the routes that cache them (that import direction
 * would be circular). Emitting inside a transaction that later rolls back
 * costs one spurious cache miss, which is harmless; listeners must stay
 * cheap and synchronous.
 */

type Listener = (workspaceId: string, marketId?: string) => void;

const listeners: Listener[] = [];

export function onPricesChanged(fn: Listener): void {
  listeners.push(fn);
}

export function emitPricesChanged(workspaceId: string, marketId?: string): void {
  for (const fn of listeners) {
    try {
      fn(workspaceId, marketId);
    } catch (e) {
      console.error('price listener failed:', e);
    }
  }
}
