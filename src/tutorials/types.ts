import type { ReactNode } from 'react';

export type Persona = 'builder' | 'trader' | 'agent';

export type TutorialId = 'builder' | 'trader' | 'agent';

export interface TutorialStep {
  id: string;
  /** Centered modal vs floating coachmark anchored to a DOM target. */
  kind: 'modal' | 'coach';
  /** Navigate here on enter (if not already there). */
  navigate?: string;
  /** Coach target: CSS selector or function returning an element. */
  target?: string;
  /** Title shown above body. */
  title?: string;
  /** Step body. ReactNode so we can interpolate context. */
  body: (ctx: TutorialContext) => ReactNode;
  /** Primary button label. Defaults to "Next" mid-tour, "Finish" on last. */
  primaryLabel?: string;
  /** Optional side effect to run when the step enters (e.g., click a button). */
  onEnter?: (ctx: TutorialContext) => void;
  /**
   * Snapshot a value before waiting; passed to waitFor on each poll.
   * If omitted, no polling happens and the user clicks Next manually.
   */
  capture?: (ctx: TutorialContext) => Promise<unknown>;
  /** Returns true when the user finished the step's action. */
  waitFor?: (initial: unknown, ctx: TutorialContext) => Promise<boolean>;
  /** Poll interval in ms (default 2500). */
  pollMs?: number;
  /** Hide the primary button while we're waiting; show "Skip step" instead. */
  waitOnly?: boolean;
}

export interface Tutorial {
  id: TutorialId;
  title: string;
  blurb: string;
  steps: TutorialStep[];
}

export interface TutorialContext {
  /** Current workspace id, if any. */
  workspaceId: string | null;
  /** Template id of the active workspace, for template-aware copy. Best-effort. */
  templateId: string | null;
}
