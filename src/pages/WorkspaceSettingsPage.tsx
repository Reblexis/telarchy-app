import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceDetail { id: string; name: string }
interface Member { identity: string; role: string }

const ROLES = ['owner', 'admin', 'trader', 'viewer'] as const;
type Role = typeof ROLES[number];

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspace } = useWorkspace(user);

  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');

  const [members, setMembers] = useState<Member[]>([]);
  const [newIdentity, setNewIdentity] = useState('');
  const [newRole, setNewRole] = useState<Role>('trader');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const wsId = workspace?.workspaceId;

  useEffect(() => {
    if (!user || !wsId || wsId === 'default') return;
    api.getWorkspace(user, wsId)
      .then((detail: WorkspaceDetail) => { setWs(detail); setName(detail.name); })
      .catch((e: Error) => setError(e.message));
    api.getWorkspaceMembers(user, wsId)
      .then((data: Member[]) => setMembers(data))
      .catch((e: Error) => console.error('Failed to load members', e));
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

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !wsId || !newIdentity.trim()) return;
    setAddError(''); setAdding(true);
    try {
      await api.inviteMember(user, wsId, newIdentity.trim(), newRole, 'agentId');
      setMembers(prev => {
        const filtered = prev.filter(m => m.identity !== newIdentity.trim());
        return [...filtered, { identity: newIdentity.trim(), role: newRole }];
      });
      setNewIdentity('');
    } catch (e: unknown) {
      setAddError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (identity: string) => {
    if (!user || !wsId) return;
    setRemoving(identity);
    try {
      await api.removeMember(user, wsId, identity);
      setMembers(prev => prev.filter(m => m.identity !== identity));
    } catch (e: unknown) {
      console.error('Failed to remove member', e);
    } finally {
      setRemoving(null);
    }
  };

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
        <p style={{ color: 'var(--text-secondary)' }}>Only workspace owners and admins can manage settings.</p>
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
        <h3 style={{ marginBottom: '1rem' }}>Members</h3>

        {members.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                {['Identity', 'Role', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.identity}>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-primary)' }}>{m.identity}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>{m.role}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                    <button
                      className="btn-danger-sm"
                      disabled={removing === m.identity}
                      onClick={() => handleRemoveMember(m.identity)}
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    >
                      {removing === m.identity ? '…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0, flex: '1 1 180px' }}>
            <label htmlFor="new-identity" style={{ fontSize: '0.8125rem' }}>Agent ID or user ID</label>
            <input
              id="new-identity"
              type="text"
              placeholder="e.g. faa-trader"
              value={newIdentity}
              onChange={e => setNewIdentity(e.target.value)}
              style={{ marginTop: '0.25rem' }}
            />
          </div>
          <div className="form-group" style={{ margin: 0, flex: '0 0 120px' }}>
            <label htmlFor="new-role" style={{ fontSize: '0.8125rem' }}>Role</label>
            <select
              id="new-role"
              value={newRole}
              onChange={e => setNewRole(e.target.value as Role)}
              style={{ marginTop: '0.25rem' }}
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="submit" disabled={adding || !newIdentity.trim()} style={{ alignSelf: 'flex-end', marginBottom: '0' }}>
            {adding ? 'Adding…' : 'Add member'}
          </button>
        </form>
        {addError && <div className="error show" style={{ marginTop: '0.5rem' }}>{addError}</div>}
      </div>
    </div>
  );
}
