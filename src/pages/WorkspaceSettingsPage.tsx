import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { Header } from '../components/Header';

interface WorkspaceDetail { id: string; name: string }

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace } = useWorkspace(user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !workspace || workspace.workspaceId === 'default') return;

    api.getWorkspace(user, workspace.workspaceId)
      .then((detail: WorkspaceDetail) => {
        setWs(detail);
        setName(detail.name);
      })
      .catch((e: Error) => setError(e.message));
  }, [user, workspace]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !workspace || workspace.workspaceId === 'default') return;
    setError('');
    setSaveMsg('');
    setSaving(true);
    try {
      await api.updateWorkspaceSettings(user, workspace.workspaceId, { name: name.trim() });
      setSaveMsg('Settings saved.');
      setWs(prev => prev ? { ...prev, name: name.trim() } : prev);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const wsHeader = (
    <Header
      activePage="metrics"
      navMode="creator"
      workspaces={allWorkspaces}
      activeWorkspaceId={workspace?.workspaceId}
      onWorkspaceSwitch={switchWorkspace}
    />
  );

  if (!workspace || workspace.workspaceId === 'default') {
    return (
      <>
        {wsHeader}
        <div className="container" style={{ maxWidth: 600, paddingTop: '2rem' }}>
          <h1>Workspace Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            You are using the default workspace. Create a named workspace to access settings.
          </p>
          <button onClick={() => navigate('/create-workspace')}>Create workspace</button>
        </div>
      </>
    );
  }

  if (workspace.tier !== 'admin') {
    return (
      <>
        {wsHeader}
        <div className="container" style={{ maxWidth: 600, paddingTop: '2rem' }}>
          <h1>Workspace Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Only workspace owners and admins can manage settings.
          </p>
          <button onClick={() => navigate('/metrics')}>Back to metrics</button>
        </div>
      </>
    );
  }

  const wsId = workspace.workspaceId;

  return (
    <>
      {wsHeader}
      <div className="container" style={{ maxWidth: 600, paddingTop: '1rem' }}>
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
      </div>
    </>
  );
}
