import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { DarkModeToggle } from '../components/DarkModeToggle';

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useDarkMode();

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);

    try {
      const ws = await api.createWorkspace(user, name.trim());

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
            Workspaces are private — you control who has access.
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
