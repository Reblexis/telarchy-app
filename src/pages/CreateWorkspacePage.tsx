import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

type TemplateId = 'startup' | 'personal' | 'blank';

export function CreateWorkspacePage() {
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
      // New workspaces default to "Open" access: listed on the marketplace and
      // the Public group gets the 'trade' capability. Owners can flip this in
      // Settings. Rationale: get first users to "agents trading on my metrics"
      // with zero decisions at signup.
      const ws = await api.createWorkspace({
        name: name.trim(),
        template: selected,
        templateParams: selected === 'startup' ? { revenueRangeMax } : undefined,
        visibility: 'public',
      });
      setActiveWorkspace(ws.id);
      const groups = await api.listGroups() as Array<{ id: string; type: string; capabilities?: string[] }>;
      const pub = groups.find(g => g.type === 'public');
      if (pub) {
        const caps = Array.from(new Set([...(pub.capabilities ?? []), 'read', 'trade']));
        await api.updateGroup(pub.id, { capabilities: caps });
      }
      clearCache();
      // Full reload so useWorkspace re-fetches the workspace list and profile
      // from scratch. A soft navigate leaves stale state in the sidebar.
      window.location.href = '/check-in?welcome=1';
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
    const pick = (id: TemplateId) => { setSelected(id); setStep('name'); };
    return (
      <>
        {nav}
        <div className="login-page">
          <div className="container" style={{ maxWidth: 360 }}>
            <h1>What do you want to improve?</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1.5rem' }}>
              {([
                { id: 'startup' as const, label: 'My startup' },
                { id: 'personal' as const, label: 'My life' },
              ]).map(t => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => pick(t.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(t.id); } }}
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
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <span
                role="button"
                tabIndex={0}
                onClick={() => pick('blank')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick('blank'); } }}
                style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                or start from scratch
              </span>
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
                <label htmlFor="rev-max">Weekly revenue target</label>
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
