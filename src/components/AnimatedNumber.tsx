import type { ReactNode } from 'react';
import { useAnimatedNumber } from '../lib/useAnimatedNumber';

/**
 * Leaf wrapper around useAnimatedNumber so the 60fps tween re-renders
 * only this component. Calling the hook from a page component re-rendered
 * the whole page every animation frame; on a floor where agents trade
 * continuously the tweens overlap into a permanent full-page render loop,
 * which is what pinned floor tabs at half a CPU core and grew them to
 * gigabytes (chart model, markdown parse and prop arrays rebuilt per
 * frame). The page passes the true value; only the painted text tweens.
 */
export function AnimatedNumber({ value, render }: { value: number; render: (shown: number) => ReactNode }) {
  const shown = useAnimatedNumber(value);
  return <>{render(shown ?? value)}</>;
}
