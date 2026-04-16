import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

type TemplateId = 'startup' | 'personal' | 'blank';

interface TemplatePreviewMetric {
  name: string;
  summary: string;
  halfLife: string;
  range: string;
}

interface TemplateOption {
  id: TemplateId;
  name: string;
  intent: string;
  metrics: TemplatePreviewMetric[];
  rationale: string;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: 'startup',
    name: 'Startup',
    intent: 'Three outcomes a founder is certain they want to maximise, each with its own timescale.',
    metrics: [
      { name: 'Weekly revenue', summary: 'Direct financial outcome.', halfLife: 'half-life 1y', range: 'you set the ceiling' },
      { name: 'Customer satisfaction', summary: 'Your honest 0-10 read on customer happiness.', halfLife: 'half-life 1y', range: '0-10' },
      { name: 'Product quality', summary: 'Internal compounding asset, 0-10.', halfLife: 'half-life 3y', range: '0-10' },
    ],
    rationale:
      'No signups, features shipped, or hours worked: those are activities, not outcomes. Propose them as tasks if you suspect they drive revenue.',
  },
  {
    id: 'personal',
    name: 'Personal',
    intent: 'Three self-reported outcomes. The guides prefer subjective scores here over upstream proxies.',
    metrics: [
      { name: 'Happiness', summary: 'Self-reported weekly, 0-10.', halfLife: 'half-life 1y', range: '0-10' },
      { name: 'Health', summary: 'Self-reported, 0-10. Compounds over years.', halfLife: 'half-life 5y', range: '0-10' },
      { name: 'Career satisfaction', summary: 'Self-reported, 0-10.', halfLife: 'half-life 3y', range: '0-10' },
    ],
    rationale:
      'No "hours slept" or "workouts per week": activities, not outcomes. If you suspect a specific habit helps, propose it as a task.',
  },
  {
    id: 'blank',
    name: 'Blank',
    intent: 'Start empty. Create your own metrics from the Metrics page.',
    metrics: [],
    rationale: 'Pick this if you already know exactly what you want to track.',
  },
];

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState<'template' | 'configure'>('template');
  const [selected, setSelected] = useState<TemplateId>('startup');
  const [name, setName] = useState('');
  const [revenueRangeMax, setRevenueRangeMax] = useState<number>(100000);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const template = TEMPLATE_OPTIONS.find(t => t.id === selected)!;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);

    try {
      const ws = await api.createWorkspace({
        name: name.trim(),
        template: selected,
        templateParams: selected === 'startup' ? { revenueRangeMax } : undefined,
      });
      setActiveWorkspace(ws.id);
      clearCache();
      navigate('/metrics', { state: { workspaceId: ws.id, fresh: true, template: selected } });
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create workspace');
      setSubmitting(false);
    }
  };

  return (
    <>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
      }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: '1rem', textDecoration: 'none', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Telarchy
        </Link>
        <Link to="/" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
          ← Back
        </Link>
      </nav>

      {step === 'template' && (
        <div style={{
          minHeight: 'calc(100vh - 57px)',
          padding: '3rem 2rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <div style={{ maxWidth: 720, width: '100%' }}>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', letterSpacing: '-0.03em', marginBottom: '0.5rem' }}>
              Pick a starting point
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2rem' }}>
              Templates create a small, opinionated set of outcome metrics. You can edit, remove, or add metrics freely after creation.{' '}
              <Link to="/guides/metric-design" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                How metrics should be designed
              </Link>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {TEMPLATE_OPTIONS.map(t => {
                const isSelected = selected === t.id;
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(t.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(t.id); } }}
                    style={{
                      textAlign: 'left',
                      border: `1px solid ${isSelected ? 'var(--focus-border)' : 'var(--border-color)'}`,
                      borderRadius: '0.75rem',
                      padding: '1.25rem 1.5rem',
                      background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 0 0 2px var(--focus-border)' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                      <strong style={{ fontSize: '1rem' }}>{t.name}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {t.metrics.length === 0 ? 'no metrics' : `${t.metrics.length} metric${t.metrics.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem 0', lineHeight: 1.5 }}>
                      {t.intent}
                    </p>
                    {t.metrics.length > 0 && (
                      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.6rem 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {t.metrics.map(m => (
                          <li key={m.name} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</span>
                            {' '}- {m.summary}{' '}
                            <span style={{ opacity: 0.7 }}>({m.halfLife}, {m.range})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', opacity: 0.85, margin: 0, fontStyle: 'italic' }}>
                      {t.rationale}
                    </p>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setStep('configure')}
                style={{ padding: '0.65rem 1.4rem', fontSize: '0.9rem' }}
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'configure' && (
        <div className="login-page">
          <div className="container" style={{ maxWidth: 480 }}>
            <button
              type="button"
              onClick={() => setStep('template')}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', padding: 0, marginBottom: '1rem' }}
            >
              ← Back to templates
            </button>
            <h1>Name your workspace</h1>
            <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
              Starting from the <strong>{template.name}</strong> template{template.metrics.length > 0 ? ` with ${template.metrics.length} metric${template.metrics.length === 1 ? '' : 's'}` : ''}. Workspaces are private by default.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="ws-name">Workspace name</label>
                <input
                  type="text"
                  id="ws-name"
                  required
                  maxLength={80}
                  placeholder="e.g. Acme Inc., My Life Metrics"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              {selected === 'startup' && (
                <div className="form-group">
                  <label htmlFor="rev-max">Weekly revenue range max (USD)</label>
                  <input
                    type="number"
                    id="rev-max"
                    min={1}
                    step={1}
                    value={revenueRangeMax}
                    onChange={e => setRevenueRangeMax(Math.max(1, Number(e.target.value) || 0))}
                  />
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                    Realistic ~2-year weekly revenue ceiling. The market has room to move inside this range; you can change it later.
                  </p>
                </div>
              )}

              <button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? 'Creating workspace...' : 'Create workspace'}
              </button>
              {error && <div className="error show">{error}</div>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
