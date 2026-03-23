import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceDetail { id: string; name: string }

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace } = useWorkspace(user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const [wsLoading, setWsLoading] = useState(true);

  const wsId = workspace?.workspaceId;

  useEffect(() => {
    if (!user || !wsId || wsId === 'default') { setWsLoading(false); return; }
    setWsLoading(true);
    api.getWorkspace(user, wsId)
      .then(detail => {
        const d = detail as WorkspaceDetail;
        setWs(d);
        setName(d.name);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setWsLoading(false));
  }, [user, wsId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId || wsId === 'default') return;
    setError(''); setSaveMsg(''); setSaving(true);
    try {
      await api.updateWorkspaceSettings(user, wsId, { name: name.trim() });
      setSaveMsg('Saved.');
      setWs(prev => prev ? { ...prev, name: name.trim() } : prev);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (wsLoading) return <div className="loading">Loading…</div>;

  if (!workspace || wsId === 'default') {
    return (
      <div className="container" style={{ maxWidth: 600 }}>
        <h1>Workspace Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          You are using the default workspace. Create a named workspace to access settings.
        </p>
        <button onClick={() => navigate('/create-workspace')}>Create workspace</button>
      </div>
    );
  }

  if (workspace.tier !== 'admin') {
    return (
      <div className="container" style={{ maxWidth: 600 }}>
        <h1>Workspace Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Only workspace admins can manage settings.</p>
        <button onClick={() => navigate('/metrics')}>Back to metrics</button>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Workspace Settings</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        ID: <code style={{ fontSize: '0.8rem' }}>{wsId}</code>
      </p>

      {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="section">
        <h3 style={{ marginBottom: '1rem' }}>General</h3>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="ws-name">Workspace name</label>
            <input
              id="ws-name"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saveMsg && <span style={{ marginLeft: '1rem', fontSize: '0.875rem', color: 'var(--success-text)' }}>{saveMsg}</span>}
        </form>
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Manage access by adding agents and users to permission groups in the{' '}
          <button
            onClick={() => navigate('/agents')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--focus-border)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}
          >
            Agents
          </button>{' '}
          page. The Admin group grants full workspace access.
        </p>
      </div>

      {ws && (
        <div className="section" style={{ marginTop: '2rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Created: {ws.id}
          </p>
        </div>
      )}
    </div>
  );
}
