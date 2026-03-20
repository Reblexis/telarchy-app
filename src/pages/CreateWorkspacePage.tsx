import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';

const VISIBILITY_OPTIONS = [
  {
    value: 'private' as const,
    label: 'Private',
    description: 'Only people you invite can view or trade',
  },
  {
    value: 'unlisted' as const,
    label: 'Unlisted',
    description: 'Anyone with the link can find and join',
  },
  {
    value: 'public' as const,
    label: 'Public',
    description: 'Listed on the public marketplace',
  },
];

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useDarkMode();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'unlisted' | 'public'>('private');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);

    try {
      const ws = await api.createWorkspace(user, name.trim(), visibility);

      // Seed a "Utility" metric so the dashboard isn't empty
      await api.createMetric(user, {
        name: 'Utility',
        description: 'Top-level score — your metrics roll up here via formulas',
        value: 0,
        formula: '0',
      });

      navigate('/metrics', { state: { workspaceId: ws.id, fresh: true } });
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create workspace');
      setSubmitting(false);
    }
  };

  return (
    <>
      <DarkModeToggle fixed />
      {/* Minimal nav */}
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
        <div className="container" style={{ maxWidth: 480 }}>
          <h1>Create your workspace</h1>
          <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
            A workspace holds your goals, markets, and forecasting activity.
            You can always change these settings later.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="ws-name">Workspace name</label>
              <input
                type="text"
                id="ws-name"
                required
                maxLength={80}
                placeholder="e.g. My Life Metrics, Team Q2 Goals"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Visibility</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                {VISIBILITY_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      border: `1px solid ${visibility === opt.value ? 'var(--focus-border)' : 'var(--border-color)'}`,
                      borderRadius: '0.375rem',
                      background: visibility === opt.value ? 'var(--focus-bg)' : 'var(--bg-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={opt.value}
                      checked={visibility === opt.value}
                      onChange={() => setVisibility(opt.value)}
                      style={{ marginTop: '0.15rem', flexShrink: 0, width: 'auto' }}
                    />
                    <span>
                      <strong style={{ display: 'block' }}>{opt.label}</strong>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating workspace...' : 'Create workspace'}
            </button>
            {error && <div className="error show">{error}</div>}
          </form>
        </div>
      </div>
    </>
  );
}
