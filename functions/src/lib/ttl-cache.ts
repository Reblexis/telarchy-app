/**
 * One TTL cache for every "compute once, serve everybody for N seconds"
 * surface. Before this existed the same map-plus-timestamp pattern was
 * hand-rolled in three places (the leaderboard board, the data-room feed,
 * the release state) and about to be copied into three more; six divergent
 * copies of eviction logic is how one of them grows a staleness bug alone.
 *
 *            ┌────────────┐  miss            ┌──────────┐
 *   get(k) ─▶│ entries map├─────────────────▶│  load()  │──▶ ONE load per key
 *            │ k→{value,  │◀─────────────────┤ (shared) │    at a time, however
 *            │   loading} │  settle: value,  └──────────┘    many readers
 *            └────────────┘  fresh from now
 *                 │ fresh, or stale while a reload runs
 *                 ▼
 *            last good value
 *
 * The rules a floor changing prices every second needs (docs/infra/deploy.md,
 * "Prices, one channel across instances"; docs/data-room.md, "The feed"):
 *
 * - ONE LOAD PER KEY AT A TIME. Concurrent misses await the same load (the
 *   cache-stampede case that mattered in the 2026-08-20 outage), and a load
 *   slower than the TTL never starts a second one: freshness counts from when
 *   a value SETTLED, not from when its load began. Counting from the start
 *   made a 20-second read start a fresh copy every 5 seconds and fill the pool.
 * - PAST THE TTL, THE LAST GOOD VALUE ANSWERS AT ONCE while one reload runs
 *   (`serveStale`, on by default). A cache whose freshness matters more than
 *   its latency (who may read a floor) turns it off and waits.
 * - A FAILURE IS RETRIED AFTER A BACKOFF, never by the very next reader: one
 *   second, doubling to thirty. Meanwhile readers get the last good value, or
 *   the same failure when there is none. Retrying on every request is how a
 *   struggling database is kept from recovering.
 * - AN INVALIDATION IS NEVER ANSWERED WITH THE VALUE FROM BEFORE IT. The entry
 *   is dropped, the next read loads afresh, and a load that began before the
 *   invalidation settles into nothing.
 *
 * SETTLEMENT MUST NOT READ ANY OF THESE CACHES. Anything that assigns money
 * runs against one fixed timestamp inside a transaction (routes/seasons.ts);
 * cached reads are for display only.
 */

/** The first wait after a failed load; it doubles with each further failure. */
export const FAILURE_BACKOFF_MS = 1_000;
/** The longest wait between retries of a failing load. */
export const FAILURE_BACKOFF_MAX_MS = 30_000;

interface Entry<A extends unknown[], V> {
  args: A;
  /** When the entry was made, for oldest-first eviction. */
  born: number;
  /** The last good value as the promise readers receive, and when it settled. */
  value: Promise<V> | null;
  at: number;
  /** The load running now, if any. */
  loading: Promise<V> | null;
  /** Consecutive failures, the last one, and when the next load may start. */
  failures: number;
  error: unknown;
  retryAt: number;
}

export interface TtlCache<A extends unknown[], V> {
  /** Cached load: a fresh value, the last value while one reload runs, or the shared load. */
  get(...args: A): Promise<V>;
  /** Drop one key (e.g. a workspace whose prices just changed). */
  invalidate(key: string): void;
  /** Drop every entry whose arguments match (e.g. every board that includes a floor). */
  invalidateWhere(match: (...args: A) => boolean): void;
  /** Drop everything. Tests and mutation paths that cross keys use this. */
  clear(): void;
}

/**
 * Every cache ever created, so the test harness can wipe them all beside the
 * data they were computed from (harness/test-db.ts truncateAll): a cache that
 * outlives a truncated database serves rows that no longer exist.
 */
const allCaches: Array<{ clear(): void }> = [];

/** Join `clearAllTtlCaches` with a cache that is not a ttlCache. */
export function onClearAllCaches(clear: () => void): void {
  allCaches.push({ clear });
}

export function clearAllTtlCaches(): void {
  for (const c of allCaches) c.clear();
}

export function ttlCache<A extends unknown[], V>(opts: {
  ttlMs: number;
  keyOf: (...args: A) => string;
  load: (...args: A) => Promise<V>;
  /** Bound the map; stale-first sweep runs past this size. Default 64. */
  maxEntries?: number;
  /** Answer past the TTL with the last value while one reload runs. Default true. */
  serveStale?: boolean;
}): TtlCache<A, V> {
  const { ttlMs, keyOf, load, maxEntries = 64, serveStale = true } = opts;
  const entries = new Map<string, Entry<A, V>>();
  allCaches.push({ clear: () => entries.clear() });

  const sweep = (now: number) => {
    if (entries.size <= maxEntries) return;
    for (const [k, e] of entries) {
      if (!e.loading && (!e.value || now - e.at >= ttlMs) && now >= e.retryAt) entries.delete(k);
    }
    // Still over after dropping stale? Evict oldest-first.
    if (entries.size > maxEntries) {
      const sorted = [...entries.entries()].sort((a, b) => a[1].born - b[1].born);
      for (const [k] of sorted.slice(0, entries.size - maxEntries)) entries.delete(k);
    }
  };

  return {
    get(...args: A): Promise<V> {
      const key = keyOf(...args);
      const now = Date.now();
      let entry = entries.get(key);
      if (entry?.value && now - entry.at < ttlMs) return entry.value;

      const created = !entry;
      if (!entry) {
        entry = { args, born: now, value: null, at: 0, loading: null, failures: 0, error: undefined, retryAt: 0 };
        entries.set(key, entry);
      }
      const stale = serveStale ? entry.value : null;
      if (entry.loading) return stale ?? entry.loading;
      if (now < entry.retryAt) return stale ?? Promise.reject(entry.error);

      const current = entry;
      const loading = load(...args);
      current.loading = loading;
      loading.then(
        () => {
          // Invalidated while loading: this value is from before it.
          if (entries.get(key) !== current) return;
          current.value = loading;
          current.at = Date.now();
          current.loading = null;
          current.failures = 0;
          current.error = undefined;
          current.retryAt = 0;
        },
        e => {
          if (entries.get(key) !== current) return;
          current.loading = null;
          current.failures += 1;
          current.error = e;
          current.retryAt =
            Date.now() + Math.min(FAILURE_BACKOFF_MAX_MS, FAILURE_BACKOFF_MS * 2 ** (current.failures - 1));
        },
      );
      // Only once its load is running, or the sweep would take the new entry
      // for an empty one and evict it.
      if (created) sweep(now);
      return stale ?? loading;
    },
    invalidate(key: string): void {
      entries.delete(key);
    },
    invalidateWhere(match: (...args: A) => boolean): void {
      for (const [k, e] of entries) if (match(...e.args)) entries.delete(k);
    },
    clear(): void {
      entries.clear();
    },
  };
}
