import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * How many credits this account could get RIGHT NOW, or null when there
 * is nothing to say (signed out, nothing available, or the read failed).
 *
 * Two things add up here: the one-time earns not yet claimed, and today's
 * daily streak if it has not been earned yet. The streak was missing
 * until 2026-08-31 and the door vanished for anyone who had finished the
 * one-time list (owner report: "where is the earn credits button?"), even
 * though trading that day was worth 25 to 100 credits to them.
 *
 * Null rather than 0 on purpose: every surface that shows this number
 * hides itself when it is null, so an account with nothing on the table
 * carries no permanent decoration, and a failed read degrades to silence
 * instead of a wrong "0 available".
 *
 * Cached module-wide for the session because three surfaces ask for it
 * (the bet ticket's ceiling line, the balance chip, the first-run line)
 * and it changes only when something is claimed.
 */
let cache: { at: number; value: number | null } | null = null;
const TTL_MS = 60_000;

export function clearEarnAvailableCache(): void {
  cache = null;
}

export function useEarnAvailable(signedIn: boolean): number | null {
  const [available, setAvailable] = useState<number | null>(cache?.value ?? null);

  useEffect(() => {
    if (!signedIn) {
      setAvailable(null);
      return;
    }
    if (cache && Date.now() - cache.at < TTL_MS) {
      setAvailable(cache.value);
      return;
    }
    let cancelled = false;
    api
      .getMyEarn()
      .then(r => {
        // Today's streak counts only while it is unclaimed, so the door
        // goes away once they have traded rather than nagging all day.
        const streak = r.streak && !r.streak.earnedToday ? r.streak.nextCredits : 0;
        const total = r.available + streak;
        const value = total > 0 ? total : null;
        cache = { at: Date.now(), value };
        if (!cancelled) setAvailable(value);
      })
      .catch(e => {
        // Silence, not an error surface: this drives a hint, and a hint
        // that fails should simply not appear.
        console.error('earn availability fetch failed:', e);
        cache = { at: Date.now(), value: null };
        if (!cancelled) setAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return available;
}
