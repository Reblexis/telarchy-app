import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

type TemplateId = 'startup' | 'personal' | 'blank';

const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: 'startup', label: 'Startup' },
  { id: 'personal', label: 'Personal' },
  { id: 'blank', label: 'Blank' },
];

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState<'template' | 'name'>('template');
  const [selected, setSelected] = useState<TemplateId | null>(null);
  const [name, setName] = useState('');
  const [revenueRangeMax, setRevenueRangeMax] = useState<number>(100000);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !selected) return;
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

  const nav = (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      padding: '1rem 2rem', borderBottom: '1px solid var(--border-color)',
    }}>
      <Link to="/" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none' }}>
        ← Back
      </Link>
    </nav>
  );

  if (step === 'template') {
    return (
      <>
        {nav}
        <div className="login-page">
          <div className="container" style={{ maxWidth: 360 }}>
            <h1>What are you tracking?</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1.5rem' }}>
              {TEMPLATES.map(t => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelected(t.id); setStep('name'); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(t.id); setStep('name'); } }}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '0.5rem',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    textAlign: 'center',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--focus-border)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {nav}
      <div className="login-page">
        <div className="container" style={{ maxWidth: 400 }}>
          <button
            type="button"
            onClick={() => setStep('template')}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem', padding: 0, marginBottom: '1rem' }}
          >
            ← Back
          </button>
          <h1>Name your workspace</h1>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input
                type="text"
                id="ws-name"
                required
                autoFocus
                maxLength={80}
                placeholder="e.g. Moonshot Labs"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            {selected === 'startup' && (
              <div className="form-group">
                <label htmlFor="rev-max">Weekly revenue ceiling</label>
                <input
                  type="number"
                  id="rev-max"
                  min={1}
                  step={1}
                  value={revenueRangeMax}
                  onChange={e => setRevenueRangeMax(Math.max(1, Number(e.target.value) || 0))}
                />
              </div>
            )}

            <button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating...' : 'Create workspace'}
            </button>
            {error && <div className="error show">{error}</div>}
          </form>
        </div>
      </div>
    </>
  );
}
