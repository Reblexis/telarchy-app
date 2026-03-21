import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { Header } from '../components/Header';

interface Member { role: string; joinedAt?: { _seconds?: number } }
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

  const [members, setMembers] = useState<Record<string, Member>>({});
  const [inviteUid, setInviteUid] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'trader' | 'viewer'>('trader');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  useEffect(() => {
    if (!user || !workspace || workspace.workspaceId === 'default') return;

    api.getProfile(user)
      .then((profile: { workspaces?: Record<string, Member> }) => {
        setMembers(profile.workspaces ?? {});
      })
      .catch((e: Error) => setError(e.message));

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

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !workspace || !inviteUid.trim()) return;
    setInviting(true);
    setInviteMsg('');
    setError('');
    try {
      await api.inviteMember(user, workspace.workspaceId, inviteUid.trim(), inviteRole);
      setInviteMsg(`Invited UID ${inviteUid.trim()} as ${inviteRole}.`);
      setInviteUid('');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (uid: string) => {
    if (!user || !workspace) return;
    if (!confirm(`Remove this member?`)) return;
    setError('');
    try {
      await api.removeMember(user, workspace.workspaceId, uid);
      setMembers(prev => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    } catch (e: unknown) {
      setError((e as Error).message);
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

        {/* Settings form */}
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

        {/* Members */}
        <div className="section">
          <h3 style={{ marginBottom: '1rem' }}>Members</h3>
          {Object.entries(members).length === 0 && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No members yet.</p>
          )}
          {Object.entries(members).map(([uid, m]) => (
            <div key={uid} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)',
              fontSize: '0.875rem',
            }}>
              <div>
                <code style={{ fontSize: '0.8rem' }}>{uid}</code>
                <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)' }}>{m.role}</span>
              </div>
              <button
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem', color: 'var(--delete-color)' }}
                onClick={() => handleRemove(uid)}
              >
                Remove
              </button>
            </div>
          ))}

          <h4 style={{ marginTop: '1.25rem', marginBottom: '0.75rem' }}>Invite by UID</h4>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Firebase UID"
              value={inviteUid}
              onChange={e => setInviteUid(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
              style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            >
              <option value="trader">Trader</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit" disabled={inviting || !inviteUid.trim()}>
              {inviting ? 'Inviting...' : 'Invite'}
            </button>
          </form>
          {inviteMsg && <p style={{ marginTop: '0.5rem', color: 'var(--success-text)', fontSize: '0.875rem' }}>{inviteMsg}</p>}
        </div>

      </div>
    </>
  );
}
