import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWelcomeTour, TourStep } from '../hooks/useWelcomeTour';

const TARGET_BY_STEP: Partial<Record<TourStep, string>> = {
  'starter-proposal': '[data-tour-id="proposals-first-row"]',
  'new-proposal': '[data-tour-id="proposals-new"]',
};

interface TooltipPos {
  top: number;
  left: number;
  arrow: 'left' | 'top';
}

function computePosition(rect: DOMRect): TooltipPos {
  // Prefer placing the tooltip to the right of the target. If that overflows
  // the viewport, place it below.
  const margin = 14;
  const tooltipWidth = 340;
  const wantRight = rect.right + margin + tooltipWidth < window.innerWidth;
  if (wantRight) {
    return {
      top: Math.max(16, rect.top + rect.height / 2 - 60),
      left: rect.right + margin,
      arrow: 'left',
    };
  }
  return {
    top: rect.bottom + margin,
    left: Math.max(16, Math.min(rect.left, window.innerWidth - tooltipWidth - 16)),
    arrow: 'top',
  };
}

export function WelcomeTour() {
  const { active, step, next, finish, skip } = useWelcomeTour();
  const navigate = useNavigate();
  const location = useLocation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  // When the tour moves into a step that targets a DOM element on /proposals,
  // navigate there first. We only do this if we are not already there.
  useEffect(() => {
    if (!active) return;
    if (step === 'starter-proposal' || step === 'new-proposal') {
      if (location.pathname !== '/proposals') {
        navigate('/proposals');
      }
    }
  }, [active, step, location.pathname, navigate]);

  // Locate the target element for the current step (if any). We poll briefly
  // because the target may not be in the DOM until the route renders.
  useLayoutEffect(() => {
    if (!active) {
      setTargetRect(null);
      return;
    }
    const selector = TARGET_BY_STEP[step];
    if (!selector) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        el.classList.add('tour-target-glow');
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        fallbackTimerRef.current = window.setTimeout(tick, 50);
      } else if (step === 'starter-proposal') {
        // No starter proposal in this workspace (existing user). Skip ahead.
        next();
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
      document.querySelectorAll('.tour-target-glow').forEach(el => el.classList.remove('tour-target-glow'));
    };
  }, [active, step, next, location.pathname]);

  // Keep position correct on window resize/scroll while the tour is open.
  useEffect(() => {
    if (!active) return;
    const selector = TARGET_BY_STEP[step];
    if (!selector) return;
    const onMove = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [active, step]);

  if (!active) return null;

  if (step === 'welcome') {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Telarchy">
        <div className="tour-modal">
          <div className="tour-eyebrow">Welcome to Telarchy</div>
          <h2 className="tour-title">An alignment layer for AI and humans</h2>
          <p className="tour-body">
            You define the metrics that matter. Participants, human or AI, propose actions.
            A market prices each proposal against your metrics before you decide, so you
            ship on a calibrated number, not a gut call.
          </p>
          <p className="tour-body tour-body-muted">
            This quick tour points out the two things that matter most: the proposal that
            is already waiting in your workspace, and the button to add your own.
          </p>
          <div className="tour-actions">
            <button type="button" className="tour-btn tour-btn-ghost" onClick={skip}>
              Skip
            </button>
            <button type="button" className="tour-btn tour-btn-primary" onClick={next}>
              Show me how
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tour complete">
        <div className="tour-modal tour-modal-compact">
          <div className="tour-eyebrow">You're set</div>
          <p className="tour-body">
            That's the loop: define metrics, watch proposals get priced, approve on a number.
            Re-open this tour any time from the sidebar.
          </p>
          <div className="tour-actions">
            <button type="button" className="tour-btn tour-btn-primary" onClick={finish}>
              Get started
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Coachmark steps.
  if (!targetRect) {
    // Target not yet mounted: show a subtle overlay only.
    return <div className="tour-overlay tour-overlay-loading" aria-hidden="true" />;
  }

  const pos = computePosition(targetRect);

  return (
    <>
      <div className="tour-overlay tour-overlay-coach" aria-hidden="true" onClick={skip} />
      <div
        className={`tour-coach tour-coach-arrow-${pos.arrow}`}
        role="dialog"
        aria-modal="false"
        style={{ top: pos.top, left: pos.left }}
      >
        {step === 'starter-proposal' && (
          <>
            <div className="tour-eyebrow">Step 1 of 2</div>
            <p className="tour-coach-body">
              This is a starter proposal already in your workspace. Open it to see how the
              market prices its predicted impact against each of your metrics. When the
              forecast convinces you, approve. If it doesn't, decline.
            </p>
          </>
        )}
        {step === 'new-proposal' && (
          <>
            <div className="tour-eyebrow">Step 2 of 2</div>
            <p className="tour-coach-body">
              Add your own actions here. Each new proposal spawns conditional markets that
              forecast how the action will move every metric in this workspace. Participants
              forecast, you decide on the number.
            </p>
          </>
        )}
        <div className="tour-actions tour-actions-compact">
          <button type="button" className="tour-btn tour-btn-ghost" onClick={skip}>
            Skip
          </button>
          <button type="button" className="tour-btn tour-btn-primary" onClick={next}>
            {step === 'new-proposal' ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
