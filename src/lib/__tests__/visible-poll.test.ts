import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startVisiblePoll } from '../visible-poll';

/**
 * A HIDDEN TAB ASKS FOR NOTHING (docs/ui-conventions.md, "A hidden tab asks
 * for nothing"). One idle laptop with background tabs made 60% of every API
 * request in half an hour (telarchy umbrella notes/gcp-cost-2026-09-13.md);
 * the helper is what every fixed-cadence poll goes through so that a hidden
 * tab costs nothing, a returning one is fresh at once, and a visible one
 * polls exactly as it did before.
 */

let visibility: 'visible' | 'hidden' = 'visible';
function setVisibility(next: 'visible' | 'hidden') {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
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

describe('while the tab is visible the cadence is unchanged', () => {
  test('it runs once every period, exactly as a plain interval would', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    expect(run).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4000);
    expect(run).toHaveBeenCalledTimes(5);
    stop();
  });

  test('immediate reads once at start, then keeps the period', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 15_000, { immediate: true });
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('A HIDDEN TAB ASKS FOR NOTHING', () => {
  test('no run while the tab is hidden, however long it stays hidden', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    vi.advanceTimersByTime(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  test('a period already under way when the tab hides does not fire late', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(900);
    setVisibility('hidden');
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(0);
    stop();
  });

  test('a poll started in a hidden tab makes its first read when the tab is first shown, immediate or not', () => {
    visibility = 'hidden';
    const eager = vi.fn();
    const plain = vi.fn();
    const stopEager = startVisiblePoll(eager, 1000, { immediate: true });
    const stopPlain = startVisiblePoll(plain, 1000);
    vi.advanceTimersByTime(10_000);
    expect(eager).toHaveBeenCalledTimes(0);
    expect(plain).toHaveBeenCalledTimes(0);
    setVisibility('visible');
    expect(eager).toHaveBeenCalledTimes(1);
    expect(plain).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(eager).toHaveBeenCalledTimes(2);
    expect(plain).toHaveBeenCalledTimes(2);
    stopEager();
    stopPlain();
  });
});

describe('coming back into view', () => {
  test('reads once, at once, and the cadence restarts from that read', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(2500);
    expect(run).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(3);
    // Never two reads back to back: the next one is a whole period later.
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(5);
    stop();
  });

  test('however often the tab flips, there is only ever one timer', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    for (let i = 0; i < 10; i++) {
      setVisibility('hidden');
      setVisibility('visible');
    }
    // One read per return, no more.
    expect(run).toHaveBeenCalledTimes(10);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(11);
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(16);
    stop();
  });

  test('a visibility event that leaves a visible tab visible starts nothing and reads nothing', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(500);
    setVisibility('visible');
    setVisibility('visible');
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(0);
    // Nor does it postpone the period already under way.
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
  });

  test('a hidden event while already hidden changes nothing, and the return still reads once', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    setVisibility('hidden');
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(0);
    setVisibility('visible');
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('stopping', () => {
  test('stop ends the poll: no run on the next period and none on a later return', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    stop();
    vi.advanceTimersByTime(5000);
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(0);
  });

  test('stop while hidden: coming back reads nothing', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    setVisibility('hidden');
    stop();
    setVisibility('visible');
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(0);
  });

  test('stopping twice is harmless', () => {
    const run = vi.fn();
    const stop = startVisiblePoll(run, 1000);
    stop();
    expect(() => stop()).not.toThrow();
  });

  test('a run may stop its own poll', () => {
    let stop = () => {};
    const run = vi.fn(() => {
      if (run.mock.calls.length >= 2) stop();
    });
    stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('a failing read', () => {
  test('a run that throws does not end the poll', () => {
    const run = vi.fn(() => {
      throw new Error('offline');
    });
    const stop = startVisiblePoll(run, 1000);
    vi.advanceTimersByTime(3000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  test('a run that rejects does not end the poll', async () => {
    const run = vi.fn(() => Promise.reject(new Error('offline')));
    const stop = startVisiblePoll(run, 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });
});
