import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setActiveWorkspace } from '../lib/api';
import { clearCache } from '../lib/cache';
import { useAuth } from '../hooks/useAuth';

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSubmitting(true);

    try {
      const ws = await api.createWorkspace(name.trim());
      setActiveWorkspace(ws.id);
      clearCache();
      navigate('/metrics', { state: { workspaceId: ws.id, fresh: true } });
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to create workspace');
      setSubmitting(false);
    }
  };

  return (
    <>
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
            Workspaces are private - you control who has access.
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
