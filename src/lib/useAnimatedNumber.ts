import { useEffect, useRef, useState } from 'react';

/**
 * Tween a number toward its target so the headline price rolls to a new
 * value instead of teleporting (owner ask 2026-08-10: "the number itself
 * can be animated"). 450ms cubic ease-out: long enough to read as motion,
 * short enough that the number is never wrong for long. First render and
 * prefers-reduced-motion snap instantly, because a market page whose price
 * is mid-lie for effect is not worth the effect.
 */
export function useAnimatedNumber(target: number | null): number | null {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setShown(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (from === null || reduced || from === target) {
      setShown(target);
      fromRef.current = target;
      return;
    }
    const start = performance.now();
    const dur = 450;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) ** 3;
      const v = from + (target - from) * eased;
      setShown(t >= 1 ? target : v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target]);

  return shown;
}
