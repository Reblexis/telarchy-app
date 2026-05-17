import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

const STORAGE_KEY = 'telarchy.tour.seen.v1';

export type TourStep = 'welcome' | 'starter-proposal' | 'new-proposal' | 'done';

interface WelcomeTourState {
  active: boolean;
  step: TourStep;
  start: () => void;
  next: () => void;
  finish: () => void;
  skip: () => void;
}

const STEP_ORDER: TourStep[] = ['welcome', 'starter-proposal', 'new-proposal', 'done'];

const Context = createContext<WelcomeTourState | null>(null);

export function WelcomeTourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState<TourStep>('welcome');

  // Auto-start on the first authenticated visit (no localStorage flag).
  // AppLayout wraps only signed-in routes, so this only fires for users.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(STORAGE_KEY)) return;
    setStep('welcome');
    setActive(true);
  }, []);

  const start = useCallback(() => {
    setStep('welcome');
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStep(prev => {
      const idx = STEP_ORDER.indexOf(prev);
      return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
    });
  }, []);

  const finish = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, '1');
    setActive(false);
  }, []);

  const skip = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, '1');
    setActive(false);
  }, []);

  return (
    <Context.Provider value={{ active, step, start, next, finish, skip }}>
      {children}
    </Context.Provider>
  );
}

export function useWelcomeTour(): WelcomeTourState {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error('useWelcomeTour must be used inside a WelcomeTourProvider');
  }
  return ctx;
}
