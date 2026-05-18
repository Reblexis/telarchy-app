import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { Persona, TutorialId } from '../tutorials/types';

const PERSONA_KEY = 'telarchy.tutorial.persona.v3';
const ACTIVE_KEY = 'telarchy.tutorial.active.v3';
const STEP_KEY = 'telarchy.tutorial.step.v3';
const COMPLETED_KEY = 'telarchy.tutorial.completed.v3';

/**
 * Master switch for auto-firing surfaces (persona picker on first visit,
 * tab-tour opt-in banners, first-seen contextual hints). Flip to `true`
 * to re-enable. Manual launches from /guides > Interactive tutorials
 * still work either way, so the tutorial system stays alive for testing.
 */
export const AUTO_TUTORIALS_ENABLED = false;

interface TutorialState {
  persona: Persona | null;
  /** True while we should be showing the persona picker. */
  needsPersona: boolean;
  /** The tutorial currently being walked through. */
  activeId: TutorialId | null;
  /** Step index within the active tutorial. */
  stepIndex: number;
  /** Which tutorials the user has completed (or skipped). */
  completed: TutorialId[];
  setPersona: (persona: Persona) => void;
  startTutorial: (id: TutorialId) => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  finishActive: () => void;
  skipActive: () => void;
  /** Skip the persona picker (and never start an initial tutorial). */
  skipPersona: () => void;
}

const Context = createContext<TutorialState | null>(null);

function loadCompleted(): TutorialId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const KNOWN: TutorialId[] = ['builder', 'trader', 'agent'];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is TutorialId => typeof id === 'string' && (KNOWN as string[]).includes(id));
  } catch {
    return [];
  }
}

function saveCompleted(ids: TutorialId[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(ids));
}

function loadInt(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(PERSONA_KEY);
    return (v as Persona | null) ?? null;
  });
  const [activeId, setActiveId] = useState<TutorialId | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(ACTIVE_KEY);
    return (v as TutorialId | null) ?? null;
  });
  const [stepIndex, setStepIndex] = useState<number>(() => loadInt(STEP_KEY, 0));
  const [completed, setCompleted] = useState<TutorialId[]>(loadCompleted);

  const needsPersona = persona === null;

  // Persist whenever they change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (persona) window.localStorage.setItem(PERSONA_KEY, persona);
    else window.localStorage.removeItem(PERSONA_KEY);
  }, [persona]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeId) window.localStorage.setItem(ACTIVE_KEY, activeId);
    else window.localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STEP_KEY, String(stepIndex));
  }, [stepIndex]);

  useEffect(() => {
    saveCompleted(completed);
  }, [completed]);

  const setPersona = useCallback((p: Persona) => {
    setPersonaState(p);
    // Pick the matching tutorial automatically: builder->builder, trader->trader, agent->agent.
    setActiveId(p as TutorialId);
    setStepIndex(0);
  }, []);

  const skipPersona = useCallback(() => {
    // "Skip" without picking still records SOMETHING so we don't reprompt.
    // Use 'builder' as the analytics default but do NOT start a tutorial.
    setPersonaState('builder');
    setActiveId(null);
    setStepIndex(0);
  }, []);

  const startTutorial = useCallback((id: TutorialId) => {
    setActiveId(id);
    setStepIndex(0);
  }, []);

  const next = useCallback(() => setStepIndex(i => i + 1), []);
  const prev = useCallback(() => setStepIndex(i => Math.max(0, i - 1)), []);
  const goTo = useCallback((i: number) => setStepIndex(Math.max(0, i)), []);

  const finishActive = useCallback(() => {
    setActiveId(prevId => {
      if (prevId) {
        setCompleted(c => (c.includes(prevId) ? c : [...c, prevId]));
      }
      return null;
    });
    setStepIndex(0);
  }, []);

  const skipActive = useCallback(() => {
    finishActive();
  }, [finishActive]);

  const value = useMemo<TutorialState>(() => ({
    persona, needsPersona, activeId, stepIndex, completed,
    setPersona, startTutorial, next, prev, goTo, finishActive, skipActive, skipPersona,
  }), [persona, needsPersona, activeId, stepIndex, completed, setPersona, startTutorial, next, prev, goTo, finishActive, skipActive, skipPersona]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTutorial(): TutorialState {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useTutorial must be used inside a TutorialProvider');
  return ctx;
}
