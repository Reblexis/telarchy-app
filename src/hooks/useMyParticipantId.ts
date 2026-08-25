import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * This visitor's participant id, or null when signed out.
 *
 * Leaderboard rows are keyed by participant id, and the session gives an auth
 * user id, which is a different thing: without this every board that wants to
 * highlight "you" would have to fetch the profile itself and they would
 * disagree about whether the answer had arrived yet.
 *
 * Null means "not signed in, or not known yet" on purpose. A board that
 * highlighted a row on a guess would be worse than one that highlights it a
 * moment late.
 */
export function useMyParticipantId(signedIn: boolean): string | null {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setId(null);
      return;
    }
    let cancelled = false;
    api
      .getProfile()
      .then((p: { participantId?: string | null }) => {
        if (!cancelled) setId(p?.participantId ?? null);
      })
      .catch(e => console.error('profile fetch failed:', e));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return id;
}
