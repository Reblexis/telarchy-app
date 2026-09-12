import { onClearAllCaches } from './ttl-cache';

/**
 * The price version of a floor, per store and workspace, on this instance
 * (docs/infra/deploy.md, "Prices, one channel across instances").
 *
 * It only ever increases, and it moves whenever something on the floor
 * changes a price: after a local write commits (lib/price-channel.ts) or when
 * another instance says one did. A cached prices answer is current exactly
 * while the version it was built at is still the version.
 *
 * One global sequence backs every key, so a version is never reused, and
 * `bumpEveryPriceVersion` (a reconnect, when messages may have been missed)
 * moves floors this instance has never seen move as well.
 */

let sequence = 0;
let everyAt = 0;
const versions = new Map<string, number>();

/** The key a floor's version and cached answer live under. */
export function priceKey(store: string, workspaceId: string): string {
  return `${store}:${workspaceId}`;
}

export function priceVersion(key: string): number {
  return Math.max(versions.get(key) ?? 0, everyAt);
}

export function bumpPriceVersion(key: string): number {
  sequence += 1;
  versions.set(key, sequence);
  return sequence;
}

/** Move every floor at once: the channel was down and may have missed a change. */
export function bumpEveryPriceVersion(): void {
  sequence += 1;
  everyAt = sequence;
  versions.clear();
}

// The test harness wipes the database between tests; versions computed
// against the old rows must not outlive them.
onClearAllCaches(() => bumpEveryPriceVersion());
