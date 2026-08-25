/**
 * One TTL cache for every "compute once, serve everybody for N seconds"
 * surface. Before this existed the same map-plus-timestamp pattern was
 * hand-rolled in three places (the leaderboard board, the data-room feed,
 * the release state) and about to be copied into three more; six divergent
 * copies of eviction logic is how one of them grows a staleness bug alone.
 *
 *            ┌────────────┐  miss / expired   ┌──────────┐
 *   get(k) ─▶│ entries map├──────────────────▶│  load()  │──▶ Promise stored
 *            │ k→{at,val} │◀──────────────────┤ (shared) │    (stampede-proof:
 *            └────────────┘   settle, keep    └──────────┘     concurrent misses
 *                 │ hit                                        await ONE load)
 *                 ▼
 *            same Promise
 *
 * The stored value is the promise itself, so ten requests arriving on a cold
 * key trigger one load, not ten (the cache-stampede case that mattered in the
 * 2026-08-20 outage). A rejected load is evicted immediately: errors are
 * never cached.
 *
 * SETTLEMENT MUST NOT READ ANY OF THESE CACHES. Anything that assigns money
 * runs against one fixed timestamp inside a transaction (routes/seasons.ts);
 * cached reads are for display only.
 */

interface Entry<V> {
  at: number;
  value: Promise<V>;
}

export interface TtlCache<A extends unknown[], V> {
  /** Cached load: same key within ttlMs returns the same settled promise. */
  get(...args: A): Promise<V>;
  /** Drop one key (e.g. a workspace whose prices just changed). */
  invalidate(key: string): void;
  /** Drop everything. Tests and mutation paths that cross keys use this. */
  clear(): void;
}

/**
 * Every cache ever created, so the test harness can wipe them all beside the
 * data they were computed from (harness/test-db.ts truncateAll): a cache that
 * outlives a truncated database serves rows that no longer exist.
 */
const allCaches: Array<{ clear(): void }> = [];

export function clearAllTtlCaches(): void {
  for (const c of allCaches) c.clear();
}

export function ttlCache<A extends unknown[], V>(opts: {
  ttlMs: number;
  keyOf: (...args: A) => string;
  load: (...args: A) => Promise<V>;
  /** Bound the map; stale-first sweep runs past this size. Default 64. */
  maxEntries?: number;
}): TtlCache<A, V> {
  const { ttlMs, keyOf, load, maxEntries = 64 } = opts;
  const entries = new Map<string, Entry<V>>();
  allCaches.push({ clear: () => entries.clear() });

  return {
    get(...args: A): Promise<V> {
      const key = keyOf(...args);
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;

      const value = load(...args);
      entries.set(key, { at: now, value });
      // Never serve a cached failure: the next call retries the load.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });

      if (entries.size > maxEntries) {
        for (const [k, v] of entries) {
          if (now - v.at >= ttlMs) entries.delete(k);
        }
        // Still over after dropping stale? Evict oldest-first.
        if (entries.size > maxEntries) {
          const sorted = [...entries.entries()].sort((a, b) => a[1].at - b[1].at);
          for (const [k] of sorted.slice(0, entries.size - maxEntries)) entries.delete(k);
        }
      }
      return value;
    },
    invalidate(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
  };
}
