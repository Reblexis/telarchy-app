import { useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWelcomeTour } from '../hooks/useWelcomeTour';

type StepKind = 'modal' | 'coach';

interface TourStep {
  id: string;
  kind: StepKind;
  /** Navigate here on entry, if not already there. */
  navigate?: string;
  /** Coach: CSS selector of the element to point at. */
  target?: string;
  title?: string;
  body: ReactNode;
  /** Side effect to run on entry, e.g. click a button. */
  onEnter?: () => void;
  /** Label for the primary button (default "Next" mid-tour, "Finish" last). */
  primaryLabel?: string;
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    kind: 'modal',
    title: 'An alignment layer for AI and humans',
    body: (
      <>
        <p className="tour-body">
          You define the metrics that matter. Participants, human or AI, propose actions.
          A market prices each proposal against your metrics before you decide, so you
          ship on a calibrated number, not a gut call.
        </p>
        <p className="tour-body tour-body-muted">
          This tour walks you through every workspace tab. About a minute. Skip any time.
        </p>
      </>
    ),
    primaryLabel: 'Start tour',
  },
  {
    id: 'nav-metrics',
    kind: 'coach',
    navigate: '/metrics',
    target: '[data-tour-id="nav-metrics"]',
    body: (
      <p className="tour-coach-body">
        <strong>Metrics</strong> are the KPIs your workspace is graded against. Every
        proposal will be priced against these. Expand a metric to see its formula,
        history, and the markets that forecast its future value.
      </p>
    ),
  },
  {
    id: 'metric-add-ghost',
    kind: 'coach',
    navigate: '/metrics',
    target: '[data-tour-id="metric-add-ghost"]',
    body: (
      <p className="tour-coach-body">
        Click this ghost card any time to add a new metric. We'll show you the form
        fields in the next step.
      </p>
    ),
  },
  {
    id: 'metric-form-name',
    kind: 'coach',
    navigate: '/metrics',
    target: '[data-tour-id="metric-form-name"]',
    onEnter: () => {
      const el = document.querySelector('[data-tour-id="metric-add-ghost"]') as HTMLElement | null;
      if (el && !el.classList.contains('expanded')) el.click();
    },
    body: (
      <p className="tour-coach-body">
        <strong>Name</strong> is the only required field. Use something objectively
        resolvable, like "MRR (USD)" or "Active users (DAU)" — avoid feelings unless
        the metric is a self-reported gut read.
      </p>
    ),
  },
  {
    id: 'metric-form-more',
    kind: 'coach',
    navigate: '/metrics',
    target: '[data-tour-id="metric-form-more-options"]',
    onEnter: () => {
      const el = document.querySelector('[data-tour-id="metric-add-ghost"]') as HTMLElement | null;
      if (el && !el.classList.contains('expanded')) el.click();
    },
    body: (
      <p className="tour-coach-body">
        Open <strong>+ More options</strong> for the rest: a starting value, an optional
        formula (compose this metric from others, e.g. <code>{'{Revenue} - {Costs}'}</code>),
        a market range (the highest value this could realistically hit, used to scale
        forecasts), and a half-life (how fast future values discount).
      </p>
    ),
  },
  {
    id: 'nav-check-in',
    kind: 'coach',
    navigate: '/check-in',
    target: '[data-tour-id="nav-check-in"]',
    body: (
      <p className="tour-coach-body">
        <strong>Check-in</strong> is the place to update metric values on a regular
        cadence. Type a number, it auto-saves. Every check-in is logged and shows up on
        the metric's history chart.
      </p>
    ),
  },
  {
    id: 'nav-proposals',
    kind: 'coach',
    navigate: '/proposals',
    target: '[data-tour-id="proposals-first-row"]',
    body: (
      <p className="tour-coach-body">
        <strong>Proposals</strong> are actions someone wants to take. A starter
        proposal is already in your workspace; opening it shows the conditional market
        that prices its predicted impact on each of your metrics. Approve when the
        forecast convinces you, decline when it doesn't.
      </p>
    ),
  },
  {
    id: 'proposals-new',
    kind: 'coach',
    navigate: '/proposals',
    target: '[data-tour-id="proposals-new"]',
    body: (
      <p className="tour-coach-body">
        Add your own actions here. Each new proposal spawns conditional markets that
        forecast how the action will move every metric. Participants forecast, you
        approve.
      </p>
    ),
  },
  {
    id: 'nav-markets',
    kind: 'coach',
    navigate: '/markets',
    target: '[data-tour-id="nav-markets"]',
    body: (
      <p className="tour-coach-body">
        <strong>Markets</strong> is the cross-cut view: every priced market across every
        proposal, with current spread and recent activity. Trade to put your forecast on
        the record; if you're right, you earn credits.
      </p>
    ),
  },
  {
    id: 'nav-participants',
    kind: 'coach',
    navigate: '/participants',
    target: '[data-tour-id="nav-participants"]',
    body: (
      <p className="tour-coach-body">
        <strong>Participants</strong> are who can forecast in this workspace. Invite
        humans by email or register AI agents with an API key. Both have identical
        trading powers; the distinction is signup method only.
      </p>
    ),
  },
  {
    id: 'nav-sources',
    kind: 'coach',
    navigate: '/sources',
    target: '[data-tour-id="nav-sources"]',
    body: (
      <p className="tour-coach-body">
        <strong>Sources</strong> auto-populate metric values from external systems:
        URLs, formulas over other metrics, GitHub repos, Codeforces ratings, and more.
        Avoids hand-keying values you can read from a system of record.
      </p>
    ),
  },
  {
    id: 'done',
    kind: 'modal',
    title: "You're set",
    body: (
      <p className="tour-body">
        That's the full loop: define metrics, propose actions, watch markets price them,
        approve on a calibrated number. Restart this tour any time from the sidebar
        ("Show product tour").
      </p>
    ),
    primaryLabel: 'Get started',
  },
];

interface TooltipPos {
  top: number;
  left: number;
  arrow: 'left' | 'top' | 'right' | 'bottom';
}

function computePosition(rect: DOMRect): TooltipPos {
  const margin = 14;
  const tooltipWidth = 360;
  const tooltipHeight = 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const canRight = rect.right + margin + tooltipWidth + 16 < vw;
  const canBelow = rect.bottom + margin + tooltipHeight + 16 < vh;
  const canAbove = rect.top - margin - tooltipHeight - 16 > 0;

  if (canRight) {
    const top = Math.max(16, Math.min(rect.top + rect.height / 2 - 60, vh - tooltipHeight - 16));
    return { top, left: rect.right + margin, arrow: 'left' };
  }
  if (canBelow) {
    const left = Math.max(16, Math.min(rect.left, vw - tooltipWidth - 16));
    return { top: rect.bottom + margin, left, arrow: 'top' };
  }
  if (canAbove) {
    const left = Math.max(16, Math.min(rect.left, vw - tooltipWidth - 16));
    return { top: rect.top - margin - tooltipHeight, left, arrow: 'bottom' };
  }
  // Fallback: dock to the right edge with a top arrow.
  return {
    top: Math.max(16, rect.bottom + margin),
    left: Math.max(16, vw - tooltipWidth - 16),
    arrow: 'top',
  };
}

export function WelcomeTour() {
  const { active, index, setTotal, next, prev, finish, skip } = useWelcomeTour();
  const navigate = useNavigate();
  const location = useLocation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    setTotal(STEPS.length);
  }, [setTotal]);

  const step = STEPS[Math.min(index, STEPS.length - 1)];

  // Side effects on entering a step: navigate, then run any onEnter callback.
  useEffect(() => {
    if (!active) return;
    if (step.navigate && location.pathname !== step.navigate) {
      navigate(step.navigate);
    }
  }, [active, index, step.navigate, location.pathname, navigate]);

  useEffect(() => {
    if (!active || !step.onEnter) return;
    // Defer to next tick so route change + DOM mount has a chance to happen.
    const t = window.setTimeout(() => step.onEnter && step.onEnter(), 80);
    return () => window.clearTimeout(t);
  }, [active, index, step.onEnter]);

  // Locate the target element for coach steps (poll briefly).
  useLayoutEffect(() => {
    if (!active || step.kind !== 'coach' || !step.target) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const selector = step.target;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        el.classList.add('tour-target-glow');
        return;
      }
      attempts += 1;
      if (attempts < 60) {
        pollTimer.current = window.setTimeout(tick, 80);
      } else {
        // Target never showed up; auto-advance so the tour does not get stuck.
        if (active) next();
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      document.querySelectorAll('.tour-target-glow').forEach(el => el.classList.remove('tour-target-glow'));
    };
  }, [active, index, step.kind, step.target, location.pathname, next]);

  // Re-position on window resize/scroll.
  useEffect(() => {
    if (!active || step.kind !== 'coach' || !step.target) return;
    const selector = step.target;
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
  }, [active, index, step.kind, step.target]);

  if (!active) return null;

  const isLast = index === STEPS.length - 1;
  const isFirst = index === 0;
  const primaryLabel = step.primaryLabel ?? (isLast ? 'Get started' : 'Next');

  const onPrimary = () => {
    if (isLast) finish();
    else next();
  };

  const progress = (
    <div className="tour-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <span
          key={s.id}
          className={`tour-dot${i === index ? ' tour-dot-active' : ''}${i < index ? ' tour-dot-done' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  if (step.kind === 'modal') {
    return (
      <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={step.title ?? 'Telarchy tour'}>
        <div className="tour-modal">
          <div className="tour-eyebrow">{isLast ? "You're set" : 'Welcome to Telarchy'}</div>
          {step.title && <h2 className="tour-title">{step.title}</h2>}
          {step.body}
          {progress}
          <div className="tour-actions">
            {!isFirst && !isLast && (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={prev}>
                Back
              </button>
            )}
            {!isLast && (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={skip}>
                Skip
              </button>
            )}
            <button type="button" className="tour-btn tour-btn-primary" onClick={onPrimary}>
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Coach step.
  if (!targetRect) {
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
        <div className="tour-eyebrow">Step {index} of {STEPS.length - 2}</div>
        {step.body}
        {progress}
        <div className="tour-actions tour-actions-compact">
          {!isFirst && (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={prev}>
              Back
            </button>
          )}
          <button type="button" className="tour-btn tour-btn-ghost" onClick={skip}>
            Skip
          </button>
          <button type="button" className="tour-btn tour-btn-primary" onClick={onPrimary}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}
