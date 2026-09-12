import { useEffect, useRef, useState } from 'react';
import { api, type FloorPriceBook } from './api';

/**
 * The floor's prices poll (docs/ui-conventions.md, "The floor's live poll").
 * Owner ask, 2026-09-12: "make sure the price refreshes at least once per
 * second ... do it efficinetly tho".
 *
 * Once a second while the tab is visible: each ask starts at most one second
 * after the previous one was SENT, brought forward by up to 150 ms of jitter so viewers who opened the page together do not ask together; the
 * ETag it last received goes back with every ask, so an unmoved floor answers
 * 304 and nothing here changes. A hidden tab asks for nothing and asks once
 * the moment it returns. Never two asks in flight. A failed ask doubles the
 * wait, up to thirty seconds; a success returns it to one second, so a
 * struggling backend is never hammered by its own viewers.
 */

export const PRICE_POLL_MS = 1000;
export const PRICE_JITTER_MS = 150;
export const PRICE_BACKOFF_MAX_MS = 30_000;

/** The wait before the next ask, after `failures` consecutive failures. */
export function priceDelay(failures: number, random: () => number = Math.random): number {
  // Healthy: the whole period from one ask's start to the next, shortened by
  // jitter so it never exceeds a second. Failing: a growing back-off.
  if (failures === 0) return PRICE_POLL_MS - Math.floor(random() * PRICE_JITTER_MS);
  const base = Math.min(PRICE_BACKOFF_MAX_MS, PRICE_POLL_MS * 2 ** failures);
  if (base >= PRICE_BACKOFF_MAX_MS) return PRICE_BACKOFF_MAX_MS;
  return base + Math.floor(random() * PRICE_JITTER_MS);
}

export interface FloorPricesState {
  /** The latest open books by market id, or null until the first body. */
  books: Map<string, FloorPriceBook> | null;
  /** When the ask that brought `books` was SENT (Date.now()), 0 before any. */
  askedAt: number;
}

export function useFloorPrices(idOrSlug: string | undefined, enabled = true): FloorPricesState {
  const [state, setState] = useState<FloorPricesState>({ books: null, askedAt: 0 });
  const etag = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !idOrSlug) return;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = (sentAt: number) => {
      if (stopped || inFlight || timer !== null || hidden()) return;
      // A healthy period runs from when the last ask was SENT, so a slow answer
      // does not push the next one past a second; a failure waits its back-off
      // from now.
      const wait = failures > 0 ? priceDelay(failures) : Math.max(0, priceDelay(0) - (Date.now() - sentAt));
      // A period already spent: ask now rather than through a zero-length timer.
      if (wait === 0) {
        void ask();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void ask();
      }, wait);
    };
    const ask = async () => {
      if (stopped || inFlight || hidden()) return;
      inFlight = true;
      const askedAt = Date.now();
      try {
        const read = (await api.getFloorPrices(idOrSlug, etag.current)) as unknown;
        if (stopped) return;
        failures = 0;
        const body = read as { changed?: unknown; etag?: string | null; prices?: { books?: unknown } };
        if (body && typeof body === 'object' && body.changed === true && Array.isArray(body.prices?.books)) {
          etag.current = body.etag ?? null;
          const books = new Map((body.prices.books as FloorPriceBook[]).map(b => [b.marketId, b]));
          setState({ books, askedAt });
        }
      } catch {
        failures += 1;
      } finally {
        inFlight = false;
        schedule(askedAt);
      }
    };
    const onVisibility = () => {
      clear();
      if (!hidden()) void ask();
    };
    void ask();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [idOrSlug, enabled]);

  return state;
}
