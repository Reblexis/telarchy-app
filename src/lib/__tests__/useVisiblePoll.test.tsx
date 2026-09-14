import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useVisiblePoll } from '../visible-poll';

/**
 * The component form of the hidden-tab rule (docs/ui-conventions.md, "A
 * hidden tab asks for nothing"): the same guarantees as startVisiblePoll,
 * plus the ones a component needs, namely that leaving the page stops it and
 * that a re-render never postpones or doubles the poll.
 */

let visibility: 'visible' | 'hidden' = 'visible';
function setVisibility(next: 'visible' | 'hidden') {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
});
afterEach(() => {
  vi.useRealTimers();
  visibility = 'visible';
});

describe('useVisiblePoll', () => {
  test('polls on its period while visible, and not while hidden', () => {
    const run = vi.fn();
    renderHook(() => useVisiblePoll(run, 30_000));
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(3);
  });

  test('leaving the page stops the poll, including the read on a later return', () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => useVisiblePoll(run, 1000));
    unmount();
    vi.advanceTimersByTime(5000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(0);
  });

  test('a re-render neither postpones the period nor starts a second timer', () => {
    const run = vi.fn();
    const { rerender } = renderHook(() => useVisiblePoll(run, 1000));
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(250);
      rerender();
    }
    // 2000 ms of renders every 250 ms: exactly two reads, on the period.
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('each read runs the latest function the component rendered with', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useVisiblePoll(fn, 1000), { initialProps: { fn: first } });
    rerender({ fn: second });
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('a disabled poll reads nothing, and enabling it starts the period', () => {
    const run = vi.fn();
    const { rerender } = renderHook(({ on }) => useVisiblePoll(run, 1000, { enabled: on }), {
      initialProps: { on: false },
    });
    vi.advanceTimersByTime(5000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(0);
    rerender({ on: true });
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('a new period replaces the old timer rather than adding one', () => {
    const run = vi.fn();
    const { rerender } = renderHook(({ ms }) => useVisiblePoll(run, ms), { initialProps: { ms: 15_000 } });
    rerender({ ms: 5_000 });
    vi.advanceTimersByTime(15_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  test('a new key restarts the period from the change', () => {
    const run = vi.fn();
    const { rerender } = renderHook(({ k }) => useVisiblePoll(run, 1000, { key: k }), { initialProps: { k: 'a' } });
    vi.advanceTimersByTime(600);
    rerender({ k: 'b' });
    vi.advanceTimersByTime(600);
    expect(run).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('immediate reads on mount when visible', () => {
    const run = vi.fn();
    renderHook(() => useVisiblePoll(run, 1000, { immediate: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
