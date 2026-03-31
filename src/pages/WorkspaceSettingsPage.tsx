import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getCustomApiKey, setCustomApiKey, setCustomApiUrl } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceDetail { id: string; name: string; customApiUrl?: string }

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const [wsLoading, setWsLoading] = useState(true);

  // Custom server state
  const [customUrl, setCustomUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);
  const [customMsg, setCustomMsg] = useState('');
  const [customError, setCustomError] = useState('');

  const wsId = workspace?.workspaceId;

  useEffect(() => {
    if (!user || !wsId || wsId === 'default') { setWsLoading(false); return; }
    setWsLoading(true);
    api.getWorkspace(wsId)
      .then(detail => {
        const d = detail as WorkspaceDetail;
        setWs(d);
        setName(d.name);
        setCustomUrl(d.customApiUrl ?? '');
        setCustomKey(getCustomApiKey(wsId) ?? '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setWsLoading(false));
  }, [user, wsId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId || wsId === 'default') return;
    setError(''); setSaveMsg(''); setSaving(true);
    try {
      await api.updateWorkspaceSettings(wsId, { name: name.trim() });
      setSaveMsg('Saved.');
      setWs(prev => prev ? { ...prev, name: name.trim() } : prev);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomServer = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId || wsId === 'default') return;
    setCustomError(''); setCustomMsg(''); setSavingCustom(true);
    try {
      const url = customUrl.trim() || null;
      await api.updateWorkspaceSettings(wsId, { customApiUrl: url });
      setCustomApiUrl(url);
      setCustomApiKey(wsId, customKey.trim() || null);
      setWs(prev => prev ? { ...prev, customApiUrl: url ?? undefined } : prev);
      setCustomMsg('Saved.');
    } catch (e: unknown) {
      setCustomError((e as Error).message);
    } finally {
      setSavingCustom(false);
    }
  };

  const handleClearCustomServer = async () => {
    if (!user || !wsId) return;
    setCustomError(''); setCustomMsg(''); setSavingCustom(true);
    try {
      await api.updateWorkspaceSettings(wsId, { customApiUrl: null });
      setCustomApiUrl(null);
      setCustomApiKey(wsId, null);
      setCustomUrl('');
      setCustomKey('');
      setWs(prev => prev ? { ...prev, customApiUrl: undefined } : prev);
      setCustomMsg('Custom server removed.');
    } catch (e: unknown) {
      setCustomError((e as Error).message);
    } finally {
      setSavingCustom(false);
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
          Manage access by adding participants to permission groups in the{' '}
          <button
            onClick={() => navigate('/agents')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--focus-border)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}
          >
            Agents
          </button>{' '}
          page. The Admin group grants full workspace access.
        </p>
      </div>

      <div className="section" style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>Custom Server</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Route all workspace data (metrics, markets, tasks, events) to a server you control.
          Neither the app developers nor the central platform can access your data.
        </p>
        {customError && <div className="error show" style={{ marginBottom: '1rem' }}>{customError}</div>}
        <form onSubmit={handleSaveCustomServer}>
          <div className="form-group">
            <label htmlFor="custom-url">Server URL</label>
            <input
              id="custom-url"
              type="url"
              placeholder="https://your-server.example.com"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="custom-key">
              API Key{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                — stored in this browser only, never sent to the central server
              </span>
            </label>
            <input
              id="custom-key"
              type="password"
              placeholder="Your server API key"
              value={customKey}
              onChange={e => setCustomKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="submit" disabled={savingCustom}>
              {savingCustom ? 'Saving...' : 'Save custom server'}
            </button>
            {ws?.customApiUrl && (
              <button
                type="button"
                className="btn-secondary"
                disabled={savingCustom}
                onClick={handleClearCustomServer}
              >
                Remove
              </button>
            )}
            {customMsg && <span style={{ fontSize: '0.875rem', color: 'var(--success-text)' }}>{customMsg}</span>}
          </div>
        </form>
        {ws?.customApiUrl && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Active: <code style={{ fontSize: '0.75rem' }}>{ws.customApiUrl}</code>
          </p>
        )}
      </div>

      {ws && (
        <div className="section" style={{ marginTop: '2rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Workspace ID: {ws.id}
          </p>
        </div>
      )}
    </div>
  );
}
