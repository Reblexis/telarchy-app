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

  const [selected, setSelected] = useState<TemplateId>('startup');
  const [name, setName] = useState('');
  const [revenueRangeMax, setRevenueRangeMax] = useState<number>(100000);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

      <div className="login-page">
        <div className="container" style={{ maxWidth: 420 }}>
          <h1>Create workspace</h1>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="ws-name">Name</label>
              <input
                type="text"
                id="ws-name"
                required
                maxLength={80}
                placeholder="e.g. Moonshot Labs"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Template</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {TEMPLATES.map(t => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(t.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(t.id); } }}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      border: `1px solid ${selected === t.id ? 'var(--focus-border)' : 'var(--border-color)'}`,
                      background: selected === t.id ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                      color: selected === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: selected === t.id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
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
