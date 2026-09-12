import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The floor's prices poll (docs/ui-conventions.md, "The floor's live poll").
 * Owner ask, 2026-09-12: "make sure the price refreshes at least once per
 * second ... do it efficinetly tho". Once a second while the tab is visible,
 * with jitter; nothing while hidden and one ask on return; the ETag sent
 * back; a 304 changing nothing; a failure backing off rather than hammering
 * a backend that is already struggling.
 */

vi.mock('../api', () => ({ api: { getFloorPrices: vi.fn() } }));

const { api } = await import('../api');
const { PRICE_POLL_MS, priceDelay, useFloorPrices } = await import('../useFloorPrices');

const getFloorPrices = vi.mocked(api.getFloorPrices as unknown as (slug: string, etag?: string | null) => unknown);

let visibility: 'visible' | 'hidden' = 'visible';
function setVisibility(next: 'visible' | 'hidden') {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

const body = (consensus: number, version = `v${consensus}`) => ({
  changed: true,
  etag: `"${version}"`,
  prices: {
    asOf: '2026-09-12T12:00:00Z',
    version,
    books: [{ marketId: 'm-1', consensus, probability: consensus / 100, pool: 100, tradeCount: 1 }],
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
  getFloorPrices.mockReset();
  getFloorPrices.mockResolvedValue({ changed: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('priceDelay', () => {
  test('a healthy poll starts at most one second after the last began, brought forward by up to 150 ms of jitter', () => {
    expect(PRICE_POLL_MS).toBe(1000);
    expect(priceDelay(0, () => 0)).toBe(1000);
    expect(priceDelay(0, () => 0.9999)).toBe(851);
  });

  test('each consecutive failure doubles the wait, up to thirty seconds', () => {
    expect(priceDelay(1, () => 0)).toBe(2000);
    expect(priceDelay(2, () => 0)).toBe(4000);
    expect(priceDelay(4, () => 0)).toBe(16000);
    expect(priceDelay(5, () => 0)).toBe(30000);
    expect(priceDelay(50, () => 0)).toBe(30000);
  });
});

describe('useFloorPrices', () => {
  // Found on the preview 2026-09-12: the next ask was timed from the END of the
  // previous answer, so a 200 to 560 ms round trip stretched every period to
  // 1.25 to 1.7 s, missing the owner's "at least once per second".
  test('A SLOW ANSWER DOES NOT STRETCH THE ONE-SECOND CADENCE', async () => {
    getFloorPrices.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ changed: false }), 400)));
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
  });

  test('AN ANSWER SLOWER THAN A SECOND IS FOLLOWED AT ONCE', async () => {
    getFloorPrices.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ changed: false }), 1300)),
    );
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
  });

  test('THE FLOOR ASKS FOR PRICES ONCE A SECOND WHILE THE TAB IS VISIBLE', async () => {
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    expect(getFloorPrices.mock.calls[0][0]).toBe('snake');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(7);
  });

  test('a hidden tab asks for nothing, and asks once the moment it is visible again', async () => {
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    act(() => setVisibility('hidden'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      setVisibility('visible');
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(3);
  });

  test('it sends back the ETag it last received', async () => {
    getFloorPrices.mockResolvedValueOnce(body(50));
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(getFloorPrices.mock.calls[0][1] ?? null).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFloorPrices.mock.calls[1][1]).toBe('"v50"');
  });

  test('a new body updates the books; a 304 changes nothing, down to the object', async () => {
    getFloorPrices.mockResolvedValueOnce(body(50));
    const { result } = renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(result.current.books?.get('m-1')?.consensus).toBe(50);
    const first = result.current.books;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.books).toBe(first);

    getFloorPrices.mockResolvedValueOnce(body(61));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.books?.get('m-1')?.consensus).toBe(61);
  });

  test('askedAt is when the request that brought the books was SENT, not when it answered', async () => {
    vi.setSystemTime(10_000);
    let answer: (v: unknown) => void = () => {};
    getFloorPrices.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
    const { result } = renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    vi.setSystemTime(10_700);
    await act(async () => {
      answer(body(50));
    });
    expect(result.current.askedAt).toBe(10_000);
  });

  test('a failed ask backs off, and a success returns it to one second', async () => {
    getFloorPrices.mockRejectedValueOnce(new Error('503')).mockRejectedValueOnce(new Error('503'));
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(4);
  });

  test('never two asks in flight: the next waits for the answer', async () => {
    let answer: (v: unknown) => void = () => {};
    getFloorPrices.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
    renderHook(() => useFloorPrices('snake'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ changed: false });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(2);
  });

  test('disabled, or without a floor, it asks for nothing', async () => {
    renderHook(() => useFloorPrices('snake', false));
    renderHook(() => useFloorPrices(undefined));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getFloorPrices).not.toHaveBeenCalled();
  });

  test('an answer of the wrong shape changes nothing', async () => {
    getFloorPrices.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    expect(result.current.books).toBeNull();
  });

  test('unmounting stops the poll', async () => {
    const { unmount } = renderHook(() => useFloorPrices('snake'));
    await act(async () => {});
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getFloorPrices).toHaveBeenCalledTimes(1);
  });
});
