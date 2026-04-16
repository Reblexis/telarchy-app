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
    intent: 'Track the outcomes that matter most for your company.',
    metrics: [
      { name: 'Weekly revenue', summary: 'in your currency', halfLife: '1y', range: 'you set the ceiling' },
      { name: 'Customer satisfaction', summary: '0-10', halfLife: '1y', range: '0-10' },
      { name: 'Product quality', summary: '0-10', halfLife: '3y', range: '0-10' },
    ],
    rationale: 'You can add, remove, or edit metrics after creation.',
  },
  {
    id: 'personal',
    name: 'Personal',
    intent: 'Track what you value as self-reported scores.',
    metrics: [
      { name: 'Happiness', summary: '0-10', halfLife: '1y', range: '0-10' },
      { name: 'Health', summary: '0-10', halfLife: '5y', range: '0-10' },
      { name: 'Career satisfaction', summary: '0-10', halfLife: '3y', range: '0-10' },
    ],
    rationale: 'You can add, remove, or edit metrics after creation.',
  },
  {
    id: 'blank',
    name: 'Blank',
    intent: 'Start empty. Create your own metrics later.',
    metrics: [],
    rationale: 'For users who know what they want to track.',
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
              Pick a template or start blank. You can change everything later.
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
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.4rem 0' }}>
                        {t.metrics.map(m => (
                          <span key={m.name} style={{
                            fontSize: '0.8rem', color: 'var(--text-secondary)',
                            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                            borderRadius: '0.375rem', padding: '0.2rem 0.5rem',
                          }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</span>
                            {' '}{m.summary}
                          </span>
                        ))}
                      </div>
                    )}
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0.4rem 0 0 0' }}>
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
            <h1>{selected === 'startup' ? 'Name your startup workspace' : selected === 'personal' ? 'Name your personal workspace' : 'Name your workspace'}</h1>
            <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
              {selected === 'startup'
                ? 'Markets will forecast your revenue, customer satisfaction, and product quality.'
                : selected === 'personal'
                  ? 'Markets will forecast your happiness, health, and career satisfaction.'
                  : 'You\'ll create your own metrics after setup.'}
            </p>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="ws-name">Workspace name</label>
                <input
                  type="text"
                  id="ws-name"
                  required
                  maxLength={80}
                  placeholder={selected === 'startup' ? 'e.g. Moonshot Labs' : selected === 'personal' ? 'e.g. Life Dashboard' : 'e.g. Q2 Goals, Side Project'}
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
