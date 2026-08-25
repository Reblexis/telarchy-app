/**
 * The shared TTL cache (lib/ttl-cache.ts): six surfaces serve from it (board,
 * data room, release state, floor payload, platform stats, replay bundle), so
 * its eviction and stampede behavior is load-bearing platform-wide.
 */

import { ttlCache } from '../lib/ttl-cache';

describe('ttlCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function counted() {
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: async (k: string) => {
        calls++;
        return `${k}:${calls}`;
      },
    });
    return { cache, calls: () => calls };
  }

  it('serves the same value within the TTL and reloads after it', async () => {
    const { cache, calls } = counted();
    expect(await cache.get('a')).toBe('a:1');
    expect(await cache.get('a')).toBe('a:1');
    expect(calls()).toBe(1);
    jest.advanceTimersByTime(1001);
    expect(await cache.get('a')).toBe('a:2');
  });

  it('keys are isolated', async () => {
    const { cache } = counted();
    expect(await cache.get('a')).toBe('a:1');
    expect(await cache.get('b')).toBe('b:2');
    expect(await cache.get('a')).toBe('a:1');
  });

  it('concurrent misses share one load (no cache stampede)', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: (_k: string) => {
        calls++;
        return new Promise<string>(r => {
          release = r;
        });
      },
    });
    const p1 = cache.get('a');
    const p2 = cache.get('a');
    release('shared');
    expect(await p1).toBe('shared');
    expect(await p2).toBe('shared');
    expect(calls).toBe(1);
  });

  it('invalidate drops one key immediately', async () => {
    const { cache, calls } = counted();
    await cache.get('a');
    cache.invalidate('a');
    expect(await cache.get('a')).toBe('a:2');
    expect(calls()).toBe(2);
  });

  it('never caches a rejected load', async () => {
    let fail = true;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: async (k: string) => {
        if (fail) throw new Error('boom');
        return k;
      },
    });
    await expect(cache.get('a')).rejects.toThrow('boom');
    // Let the rejection-eviction microtask run.
    await Promise.resolve();
    fail = false;
    expect(await cache.get('a')).toBe('a');
  });

  it('bounds the map at maxEntries, evicting oldest-first', async () => {
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 60_000,
      maxEntries: 2,
      keyOf: (k: string) => k,
      load: async (k: string) => {
        calls++;
        return k;
      },
    });
    await cache.get('a');
    jest.advanceTimersByTime(10);
    await cache.get('b');
    jest.advanceTimersByTime(10);
    await cache.get('c'); // evicts 'a' (oldest, none stale yet)
    const before = calls;
    await cache.get('b'); // still cached
    expect(calls).toBe(before);
    await cache.get('a'); // was evicted -> reloads
    expect(calls).toBe(before + 1);
  });
});
