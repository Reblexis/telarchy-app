/**
 * The shared TTL cache (lib/ttl-cache.ts): six surfaces serve from it (board,
 * data room, release state, floor payload, platform stats, replay bundle), so
 * its eviction and stampede behavior is load-bearing platform-wide.
 *
 * The rules pinned here are the ones a floor changing prices every second
 * needs: a read past the TTL is answered at once from the last good value
 * while ONE reload runs; a load slower than the TTL never starts a second
 * one; a failure is retried after a backoff, never by the very next reader;
 * and an invalidation is never answered with the value from before it.
 */

import { FAILURE_BACKOFF_MAX_MS, FAILURE_BACKOFF_MS, ttlCache } from '../lib/ttl-cache';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

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

  /** A load the test settles by hand, one resolver per call. */
  function manual(opts: { serveStale?: boolean } = {}) {
    const pending: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: (_k: string) =>
        new Promise<string>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
      ...opts,
    });
    return { cache, pending };
  }

  it('serves the same value within the TTL', async () => {
    const { cache, calls } = counted();
    expect(await cache.get('a')).toBe('a:1');
    expect(await cache.get('a')).toBe('a:1');
    expect(calls()).toBe(1);
  });

  it('PAST THE TTL A READ IS ANSWERED AT ONCE WITH THE LAST VALUE WHILE ONE RELOAD RUNS', async () => {
    const { cache, calls } = counted();
    expect(await cache.get('a')).toBe('a:1');
    jest.advanceTimersByTime(1001);
    // Readers arriving together, before the reload settles, all get the last value.
    expect(await Promise.all([cache.get('a'), cache.get('a'), cache.get('a')])).toEqual(['a:1', 'a:1', 'a:1']);
    await flush();
    expect(calls()).toBe(2);
    expect(await cache.get('a')).toBe('a:2');
  });

  it('A LOAD SLOWER THAN THE TTL NEVER STARTS A SECOND ONE, and freshness counts from when it settled', async () => {
    const { cache, pending } = manual();
    const first = cache.get('a');
    jest.advanceTimersByTime(5000); // the load takes five TTLs
    void cache.get('a');
    void cache.get('a');
    expect(pending).toHaveLength(1);
    pending[0].resolve('v1');
    expect(await first).toBe('v1');
    jest.advanceTimersByTime(900); // fresh: counted from the settle, not the start
    expect(await cache.get('a')).toBe('v1');
    expect(pending).toHaveLength(1);

    jest.advanceTimersByTime(200); // now stale: one reload, however many readers
    for (let i = 0; i < 5; i++) expect(await cache.get('a')).toBe('v1');
    jest.advanceTimersByTime(20_000); // the reload is slow too
    for (let i = 0; i < 5; i++) expect(await cache.get('a')).toBe('v1');
    expect(pending).toHaveLength(2);
    pending[1].resolve('v2');
    await flush();
    expect(await cache.get('a')).toBe('v2');
    expect(pending).toHaveLength(2);
  });

  it('concurrent misses share one load (no cache stampede)', async () => {
    const { cache, pending } = manual();
    const p1 = cache.get('a');
    const p2 = cache.get('a');
    expect(pending).toHaveLength(1);
    pending[0].resolve('shared');
    expect(await p1).toBe('shared');
    expect(await p2).toBe('shared');
  });

  it('keys are isolated', async () => {
    const { cache } = counted();
    expect(await cache.get('a')).toBe('a:1');
    expect(await cache.get('b')).toBe('b:2');
    expect(await cache.get('a')).toBe('a:1');
  });

  it('invalidate drops one key immediately', async () => {
    const { cache, calls } = counted();
    await cache.get('a');
    cache.invalidate('a');
    expect(await cache.get('a')).toBe('a:2');
    expect(calls()).toBe(2);
  });

  it('A READ AFTER AN INVALIDATION NEVER ANSWERS THE VALUE FROM BEFORE IT, even while an older reload runs', async () => {
    const { cache, pending } = manual();
    const first = cache.get('a');
    pending[0].resolve('before');
    expect(await first).toBe('before');
    jest.advanceTimersByTime(1001);
    expect(await cache.get('a')).toBe('before'); // stale, reload 2 starts
    expect(pending).toHaveLength(2);

    cache.invalidate('a'); // e.g. a trade just committed
    const after = cache.get('a');
    expect(pending).toHaveLength(3);
    pending[2].resolve('after');
    expect(await after).toBe('after');
    // The reload that started before the invalidation settles late: it must
    // not replace the newer value.
    pending[1].resolve('stale-reload');
    await flush();
    expect(await cache.get('a')).toBe('after');
  });

  it('A FAILED RELOAD KEEPS SERVING THE LAST VALUE AND WAITS BEFORE TRYING AGAIN, doubling the wait', async () => {
    let fail = false;
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: async (_k: string) => {
        calls++;
        if (fail) throw new Error('database gone');
        return `ok:${calls}`;
      },
    });
    expect(await cache.get('a')).toBe('ok:1');
    fail = true;
    jest.advanceTimersByTime(1001);
    expect(await cache.get('a')).toBe('ok:1');
    await flush();
    expect(calls).toBe(2);

    // Within the backoff nobody retries, however many readers arrive.
    for (let i = 0; i < 5; i++) expect(await cache.get('a')).toBe('ok:1');
    jest.advanceTimersByTime(FAILURE_BACKOFF_MS - 1);
    expect(await cache.get('a')).toBe('ok:1');
    await flush();
    expect(calls).toBe(2);

    jest.advanceTimersByTime(2);
    expect(await cache.get('a')).toBe('ok:1');
    await flush();
    expect(calls).toBe(3);

    // The second failure waits twice as long.
    jest.advanceTimersByTime(FAILURE_BACKOFF_MS + 1);
    await cache.get('a');
    await flush();
    expect(calls).toBe(3);
    jest.advanceTimersByTime(FAILURE_BACKOFF_MS);
    await cache.get('a');
    await flush();
    expect(calls).toBe(4);

    // Recovery: the next retry succeeds and the fresh value is served.
    fail = false;
    jest.advanceTimersByTime(4 * FAILURE_BACKOFF_MS + 1);
    await cache.get('a');
    await flush();
    expect(await cache.get('a')).toBe('ok:5');
  });

  it('WITH NOTHING TO FALL BACK ON, A FAILURE IS SHARED FOR THE BACKOFF AND RETRIED AFTER IT', async () => {
    let fail = true;
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: async (k: string) => {
        calls++;
        if (fail) throw new Error('boom');
        return k;
      },
    });
    await expect(cache.get('a')).rejects.toThrow('boom');
    await flush();
    await expect(cache.get('a')).rejects.toThrow('boom');
    await expect(cache.get('a')).rejects.toThrow('boom');
    expect(calls).toBe(1);
    fail = false;
    jest.advanceTimersByTime(FAILURE_BACKOFF_MS + 1);
    expect(await cache.get('a')).toBe('a');
    expect(calls).toBe(2);
  });

  it('the failure backoff never waits longer than its cap', async () => {
    let fail = true;
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 1000,
      keyOf: (k: string) => k,
      load: async (k: string) => {
        calls++;
        if (fail) throw new Error('boom');
        return k;
      },
    });
    for (let i = 0; i < 12; i++) {
      await cache.get('a').catch(() => {});
      await flush();
      jest.advanceTimersByTime(FAILURE_BACKOFF_MAX_MS + 1);
    }
    expect(calls).toBe(12);
    fail = false;
    expect(await cache.get('a')).toBe('a');
  });

  it('with serveStale off, a read past the TTL waits for the fresh value, still one load', async () => {
    const { cache, pending } = manual({ serveStale: false });
    const first = cache.get('a');
    pending[0].resolve('v1');
    expect(await first).toBe('v1');
    jest.advanceTimersByTime(1001);
    const p1 = cache.get('a');
    const p2 = cache.get('a');
    expect(pending).toHaveLength(2);
    pending[1].resolve('v2');
    expect(await p1).toBe('v2');
    expect(await p2).toBe('v2');
  });

  it('invalidateWhere drops every entry whose arguments match, and nothing else', async () => {
    let calls = 0;
    const cache = ttlCache({
      ttlMs: 60_000,
      keyOf: (ids: string[]) => ids.join(','),
      load: async (ids: string[]) => {
        calls++;
        return `${ids.join(',')}:${calls}`;
      },
    });
    await cache.get(['A', 'B']);
    await cache.get(['B']);
    await cache.get(['C']);
    expect(calls).toBe(3);
    cache.invalidateWhere(ids => ids.includes('B'));
    expect(await cache.get(['C'])).toBe('C:3');
    expect(calls).toBe(3);
    await cache.get(['B']);
    await cache.get(['A', 'B']);
    expect(calls).toBe(5);
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
