import { useCallback, useEffect, useState } from 'react';
import { useTutorial, AUTO_TUTORIALS_ENABLED } from './useTutorial';

const STORAGE_PREFIX = 'telarchy.firstSeen.';

interface FirstSeenHint {
  shouldShow: boolean;
  dismiss: () => void;
}

/**
 * One-shot contextual coachmark that fires the first time a user lands on a
 * surface that wasn't covered by the welcome tour. Keyed in localStorage so a
 * dismissal persists across reloads. Suppressed while the welcome tour is
 * active so the two overlays never stack.
 */
export function useFirstSeenHint(key: string): FirstSeenHint {
  const { activeId, needsPersona } = useTutorial();
  const tourActive = activeId !== null || needsPersona;
  const [shouldShow, setShouldShow] = useState(false);
  const storageKey = `${STORAGE_PREFIX}${key}`;

  useEffect(() => {
    if (!AUTO_TUTORIALS_ENABLED) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(storageKey)) return;
    if (tourActive) return;
    setShouldShow(true);
  }, [storageKey, tourActive]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, '1');
    setShouldShow(false);
  }, [storageKey]);

  return { shouldShow, dismiss };
}
