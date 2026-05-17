import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

const STORAGE_KEY = 'telarchy.tour.seen.v2';

interface WelcomeTourState {
  active: boolean;
  index: number;
  totalSteps: number;
  setTotal: (n: number) => void;
  start: () => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  finish: () => void;
  skip: () => void;
}

const Context = createContext<WelcomeTourState | null>(null);

export function WelcomeTourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(STORAGE_KEY)) return;
    setIndex(0);
    setActive(true);
  }, []);

  const setTotal = useCallback((n: number) => setTotalSteps(n), []);

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setIndex(i => Math.min(i + 1, Math.max(totalSteps - 1, 0)));
  }, [totalSteps]);

  const prev = useCallback(() => {
    setIndex(i => Math.max(i - 1, 0));
  }, []);

  const goTo = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(i, Math.max(totalSteps - 1, 0))));
  }, [totalSteps]);

  const finish = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, '1');
    setActive(false);
  }, []);

  const skip = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, '1');
    setActive(false);
  }, []);

  return (
    <Context.Provider value={{ active, index, totalSteps, setTotal, start, next, prev, goTo, finish, skip }}>
      {children}
    </Context.Provider>
  );
}

export function useWelcomeTour(): WelcomeTourState {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useWelcomeTour must be used inside a WelcomeTourProvider');
  return ctx;
}
