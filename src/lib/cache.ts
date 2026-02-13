// Simple in-memory cache that persists across React route changes (but not page reloads).
// Each entry has a maxAge after which it's considered stale.

const store = new Map<string, { data: unknown; ts: number }>();

const DEFAULT_MAX_AGE = 30_000; // 30 seconds

export function cacheGet<T>(key: string, maxAge = DEFAULT_MAX_AGE): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAge) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function cacheSet(key: string, data: unknown): void {
  store.set(key, { data, ts: Date.now() });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}
