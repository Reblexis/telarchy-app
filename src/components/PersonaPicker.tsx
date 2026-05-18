import { useState } from 'react';
import { useTutorial, AUTO_TUTORIALS_ENABLED } from '../hooks/useTutorial';
import { api } from '../lib/api';
import type { Persona } from '../tutorials/types';

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
  const { needsPersona, setPersona, skipPersona } = useTutorial();
  const [submitting, setSubmitting] = useState<Persona | null>(null);

  if (!AUTO_TUTORIALS_ENABLED) return null;
  if (!needsPersona) return null;

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
