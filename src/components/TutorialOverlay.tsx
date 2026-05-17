import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTutorial } from '../hooks/useTutorial';
import { useWorkspace } from '../hooks/useWorkspace';
import { getTutorial } from '../tutorials';
import type { TutorialContext, TutorialStep } from '../tutorials/types';

interface TooltipPos {
  top: number;
  left: number;
  arrow: 'left' | 'top' | 'right' | 'bottom';
}

function computePosition(rect: DOMRect): TooltipPos {
  const margin = 14;
  const w = 360;
  const h = 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (rect.right + margin + w + 16 < vw) {
    const top = Math.max(16, Math.min(rect.top + rect.height / 2 - 60, vh - h - 16));
    return { top, left: rect.right + margin, arrow: 'left' };
  }
  if (rect.bottom + margin + h + 16 < vh) {
    const left = Math.max(16, Math.min(rect.left, vw - w - 16));
    return { top: rect.bottom + margin, left, arrow: 'top' };
  }
  if (rect.top - margin - h - 16 > 0) {
    const left = Math.max(16, Math.min(rect.left, vw - w - 16));
    return { top: rect.top - margin - h, left, arrow: 'bottom' };
  }
  return { top: Math.max(16, rect.bottom + margin), left: Math.max(16, vw - w - 16), arrow: 'top' };
}

export function TutorialOverlay() {
  const { activeId, stepIndex, next, prev, finishActive, skipActive } = useTutorial();
  const { workspace } = useWorkspace(true);
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const targetPoll = useRef<number | null>(null);

  const tutorial = activeId ? getTutorial(activeId) : null;
  const step: TutorialStep | null = tutorial && stepIndex < tutorial.steps.length ? tutorial.steps[stepIndex] : null;
  const isLast = !!tutorial && stepIndex >= tutorial.steps.length - 1;

  const ctx: TutorialContext = useMemo(() => ({
    workspaceId: workspace?.workspaceId || null,
    // We don't currently surface the workspace template id in useWorkspace; the
    // builder tutorial degrades to a generic suggestion if templateId is null.
    templateId: null,
  }), [workspace?.workspaceId]);

  // Combined entry: probe waitFor once; if already satisfied, advance without
  // navigating. Otherwise navigate, run onEnter, and start the poll loop.
  // We deliberately omit location.pathname from deps so this fires only on
  // step (and ctx) changes; the navigate inside reads the current pathname.
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    let initial: unknown = null;

    (async () => {
      if (step.capture && step.waitFor) {
        try {
          initial = await step.capture(ctx);
          if (cancelled) return;
          const done = await step.waitFor(initial, ctx);
          if (cancelled) return;
          if (done) {
            next();
            return;
          }
        } catch (e) {
          console.error('Tutorial initial probe failed:', e);
        }
      }

      if (cancelled) return;

      if (step.navigate && window.location.pathname !== step.navigate) {
        navigate(step.navigate);
      }
      if (step.onEnter) {
        window.setTimeout(() => { if (!cancelled) step.onEnter && step.onEnter(ctx); }, 80);
      }

      if (step.capture && step.waitFor) {
        setWaiting(true);
        const pollMs = step.pollMs ?? 2500;
        const tick = async () => {
          if (cancelled) return;
          try {
            const done = await step.waitFor!(initial, ctx);
            if (cancelled) return;
            if (done) {
              setWaiting(false);
              next();
              return;
            }
          } catch (e) {
            console.error('Tutorial poll failed:', e);
          }
          if (cancelled) return;
          pollTimer.current = window.setTimeout(tick, pollMs);
        };
        pollTimer.current = window.setTimeout(tick, pollMs);
      } else {
        setWaiting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      setWaiting(false);
    };
  }, [step, ctx, next, navigate]);

  // Locate coach target (poll briefly).
  useLayoutEffect(() => {
    if (!step || step.kind !== 'coach' || !step.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const selector = step.target;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        setRect(el.getBoundingClientRect());
        el.classList.add('tour-target-glow');
        return;
      }
      attempts += 1;
      if (attempts < 60) {
        targetPoll.current = window.setTimeout(tick, 80);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (targetPoll.current) window.clearTimeout(targetPoll.current);
      document.querySelectorAll('.tour-target-glow').forEach(el => el.classList.remove('tour-target-glow'));
    };
  }, [step, location.pathname]);

  // Re-position on resize/scroll.
  useEffect(() => {
    if (!step || step.kind !== 'coach' || !step.target) return;
    const selector = step.target;
    const onMove = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [step]);


  if (!tutorial || !step) return null;

  const totalSteps = tutorial.steps.length;
  const onPrimary = () => {
    if (isLast) finishActive();
    else next();
  };

  const progress = (
    <div className="tour-progress" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
      {tutorial.steps.map((s, i) => (
        <span
          key={s.id}
          className={`tour-dot${i === stepIndex ? ' tour-dot-active' : ''}${i < stepIndex ? ' tour-dot-done' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  const body = step.body(ctx);

  if (step.kind === 'modal') {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={step.title ?? tutorial.title}>
        <div className="tour-modal">
          <div className="tour-eyebrow">{isLast ? 'Done' : tutorial.title}</div>
          {step.title && <h2 className="tour-title">{step.title}</h2>}
          <p className="tour-body">{body}</p>
          {progress}
          <div className="tour-actions">
            {stepIndex > 0 && !isLast && (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={prev}>Back</button>
            )}
            {!isLast && (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={skipActive}>Skip tutorial</button>
            )}
            <button type="button" className="tour-btn tour-btn-primary" onClick={onPrimary}>
              {step.primaryLabel ?? (isLast ? 'Finish' : 'Next')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Target hasn't mounted yet; render nothing rather than a dim layer.
  if (!rect) return null;
  const pos = computePosition(rect);

  return (
    <>
      {/* No dim backdrop for coach steps: the page underneath stays at
          its normal brightness so any modals, forms, or buttons the
          user opens during the step look exactly the way they normally
          would. The orange-pulse outline on the highlighted target and
          the coachmark card itself are sufficient cues. */}
      <div
        className={`tour-coach tour-coach-arrow-${pos.arrow}`}
        role="dialog"
        aria-modal="false"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="tour-eyebrow">Step {stepIndex + 1} of {totalSteps}</div>
        {step.title && <h3 className="tour-coach-title">{step.title}</h3>}
        <p className="tour-coach-body">{body}</p>
        {waiting && (
          <div className="tour-waiting" aria-live="polite">
            <span className="tour-waiting-dot" /> Waiting for you to finish…
          </div>
        )}
        {progress}
        <div className="tour-actions tour-actions-compact">
          {stepIndex > 0 && (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={prev}>Back</button>
          )}
          <button type="button" className="tour-btn tour-btn-ghost" onClick={skipActive}>Skip tutorial</button>
          {step.waitOnly ? (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={next}>I'll do it later</button>
          ) : (
            <button type="button" className="tour-btn tour-btn-primary" onClick={onPrimary}>
              {step.primaryLabel ?? (isLast ? 'Finish' : 'Next')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
