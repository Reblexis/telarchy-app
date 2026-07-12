import { useEffect, useState } from 'react';
import { useTutorial, AUTO_TUTORIALS_ENABLED } from '../hooks/useTutorial';
import { api } from '../lib/api';
import type { Persona } from '../tutorials/types';

const INTENT_TO_PERSONA: Record<string, Persona> = {
  creator: 'builder',
  trader: 'trader',
  agent: 'agent',
};

const OPTIONS: Array<{ id: Persona; intent: 'creator' | 'trader' | 'agent'; title: string; blurb: string }> = [
  {
    id: 'builder',
    intent: 'creator',
    title: 'Improve company or startup decisions',
    blurb: "Track KPIs, price proposed actions with conditional markets, approve on a calibrated number.",
  },
  {
    id: 'trader',
    intent: 'trader',
    title: 'Trade and forecast for credits',
    blurb: "Browse public workspaces in the Marketplace, predict their metrics, earn credits when you're right.",
  },
  {
    id: 'agent',
    intent: 'agent',
    title: 'Build or integrate an AI participant',
    blurb: 'Plug an AI agent into the API, register with a key, push telemetry, run autonomous trading strategies.',
  },
];

export function PersonaPicker() {
  const { needsPersona, setPersona, adoptPersona, skipPersona } = useTutorial();
  const [submitting, setSubmitting] = useState<Persona | null>(null);
  // null = still deciding; the picker must not flash while we check the
  // server, so nothing renders until this resolves to true.
  const [shouldShow, setShouldShow] = useState<boolean | null>(null);

  // localStorage is per-device, but the persona choice is written to the
  // profile as `intent`. Recover it before prompting: a returning user on a
  // new browser (or after clearing storage) gets their track back silently,
  // and anyone who already runs workspaces is never interrupted with a
  // first-visit question.
  useEffect(() => {
    if (!AUTO_TUTORIALS_ENABLED || !needsPersona) { setShouldShow(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [profile, workspaces] = await Promise.all([
          api.getProfile() as Promise<{ intent?: string | null }>,
          api.listWorkspaces().catch(() => []) as Promise<unknown[]>,
        ]);
        if (cancelled) return;
        const recovered = profile.intent ? INTENT_TO_PERSONA[profile.intent] : undefined;
        if (recovered) { adoptPersona(recovered); setShouldShow(false); return; }
        if (Array.isArray(workspaces) && workspaces.length > 0) {
          // Existing account from before personas: don't nag; default silently.
          adoptPersona('builder');
          setShouldShow(false);
          return;
        }
        setShouldShow(true);
      } catch {
        if (!cancelled) setShouldShow(true);
      }
    })();
    return () => { cancelled = true; };
  }, [needsPersona, adoptPersona]);

  if (!AUTO_TUTORIALS_ENABLED) return null;
  if (!needsPersona || shouldShow !== true) return null;

  const onPick = async (option: typeof OPTIONS[number]) => {
    setSubmitting(option.id);
    // Fire-and-forget the backend write; the local state machine advances
    // regardless so the user never waits on the network for a UX choice.
    api.upsertProfile({ intent: option.intent })
      .catch(e => console.error('PersonaPicker: upsertProfile failed', e));
    setPersona(option.id);
  };

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="What brings you to Telarchy?">
      <div className="tour-modal persona-picker">
        <div className="tour-eyebrow">Welcome to Telarchy</div>
        <h2 className="tour-title">What do you want to do here?</h2>
        <p className="tour-body tour-body-muted">
          Pick the one that fits best. We'll point you at the right tabs and walk you through
          the first few actions. You can switch tracks any time from the Tutorials hub.
        </p>
        <div className="persona-options">
          {OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className="persona-option"
              disabled={submitting !== null}
              data-tour-id={`persona-${opt.id}`}
              onClick={() => onPick(opt)}
            >
              <div className="persona-option-title">{opt.title}</div>
              <div className="persona-option-blurb">{opt.blurb}</div>
            </button>
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-btn tour-btn-ghost" onClick={skipPersona}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
