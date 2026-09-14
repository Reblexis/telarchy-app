import { useEffect, useRef } from 'react';

/**
 * A hidden tab asks for nothing (docs/ui-conventions.md, "A hidden tab asks
 * for nothing"). Every fixed-cadence poll in the frontend goes through here;
 * `polls-pause-when-hidden.test.ts` fails the build on a `setInterval`
 * elsewhere that is not a local clock.
 *
 * While the tab is visible the poll runs once per period, exactly like a
 * plain interval. While it is hidden no run happens at all. When the tab is
 * shown again it runs once at once and the period restarts from that run, so
 * a returning viewer is fresh immediately and never gets two reads back to
 * back. An event that leaves the tab as it was starts nothing, so there is
 * only ever one timer per poll however often the tab flips.
 */

export function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export interface VisiblePollOptions {
  /** Also run once at start (only if the tab is visible; a hidden tab runs on its first return). */
  immediate?: boolean;
}

/** Start a poll that pauses while the tab is hidden. Returns the function that stops it. */
export function startVisiblePoll(run: () => unknown, intervalMs: number, options: VisiblePollOptions = {}): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const fire = () => {
    if (stopped) return;
    try {
      const out = run();
      // A rejected read is the caller's to report; it must not end the poll
      // or surface as an unhandled rejection.
      if (out && typeof (out as PromiseLike<unknown>).then === 'function') {
        (out as PromiseLike<unknown>).then(undefined, () => {});
      }
    } catch {
      /* the next period tries again */
    }
  };
  const resume = () => {
    if (timer === null && !stopped) timer = setInterval(fire, intervalMs);
  };
  const pause = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (stopped) return;
    if (isTabHidden()) {
      pause();
      return;
    }
    // Already running means the tab was already visible: nothing changed.
    if (timer !== null) return;
    fire();
    resume();
  };

  if (!isTabHidden()) {
    if (options.immediate) fire();
    resume();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stopped = true;
    pause();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

export interface UseVisiblePollOptions extends VisiblePollOptions {
  /** False keeps the poll off. Default true. */
  enabled?: boolean;
  /** A change restarts the period from that moment (e.g. a new slug or filter). */
  key?: unknown;
}

/**
 * The component form: runs the latest `run` the component rendered with, so a
 * re-render neither postpones the period nor starts a second timer; leaving
 * the page stops it.
 */
export function useVisiblePoll(run: () => unknown, intervalMs: number, options: UseVisiblePollOptions = {}): void {
  const { enabled = true, immediate = false, key } = options;
  const runRef = useRef(run);
  runRef.current = run;
  // `key` is a dependency on purpose: a new one restarts the period.
  useEffect(() => {
    if (!enabled) return;
    return startVisiblePoll(() => runRef.current(), intervalMs, { immediate });
  }, [enabled, intervalMs, immediate, key]);
}
