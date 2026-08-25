/**
 * The season clock, ticking, for a component to render.
 *
 * Kept apart from `season-clock.ts` so that module stays pure and testable
 * without a DOM. The tick interval comes from `clockTickMs`, so a two-day
 * countdown repaints every quarter hour and the last minute repaints every
 * second, without each surface picking its own number.
 */

import { useEffect, useState } from 'react';
import type { PrizeSeason } from './api';
import { clockTickMs, type SeasonClock, seasonClock } from './season-clock';

export function useSeasonClock(season: PrizeSeason | null): SeasonClock | null {
  const [now, setNow] = useState(() => new Date());

  const clock = season ? seasonClock(season, now) : null;
  const tick = clock ? clockTickMs(clock) : 0;

  useEffect(() => {
    if (!tick) return;
    const id = setInterval(() => setNow(new Date()), tick);
    return () => clearInterval(id);
  }, [tick]);

  return clock;
}
