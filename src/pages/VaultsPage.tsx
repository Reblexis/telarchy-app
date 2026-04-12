import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import type { Vault, PermissionGroup } from '../types';

export function VaultsPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';

  const [vaults, setVaults] = useState<Vault[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);

  // Expanded vault (view/edit)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedVault, setExpandedVault] = useState<Vault | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const [vaultData, groupData] = await Promise.all([
      api.listVaults().catch((e: Error) => { setError(e.message); return []; }),
      isAdmin ? api.listGroups().catch(() => []) : Promise.resolve([]),
    ]);
    setVaults(vaultData ?? []);
    setGroups(groupData ?? []);
    setLoading(false);
  }, [user, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const handleExpand = async (vaultId: string) => {
    if (expandedId === vaultId) {
      setExpandedId(null);
      setExpandedVault(null);
      return;
    }
    setExpandedId(vaultId);
    setExpandedVault(null);
    setLoadingContent(true);
    try {
      const full = await api.getVault(vaultId) as Vault;
      setExpandedVault(full);
      setEditName(full.name);
      setEditDesc(full.description);
      setEditContent(full.content ?? '');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoadingContent(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await api.createVault({ name: newName.trim(), description: newDesc.trim(), content: newContent });
      setNewName(''); setNewDesc(''); setNewContent('');
      setShowCreate(false);
      await load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!expandedId) return;
    setSaving(true);
    setError('');
    try {
      await api.updateVault(expandedId, {
        name: editName.trim(),
        description: editDesc.trim(),
        content: editContent,
      });
      await load();
      // Refresh expanded vault
      const full = await api.getVault(expandedId) as Vault;
      setExpandedVault(full);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (vaultId: string) => {
    if (!confirm('Delete this vault? This cannot be undone.')) return;
    setError('');
    try {
      await api.deleteVault(vaultId);
      if (expandedId === vaultId) { setExpandedId(null); setExpandedVault(null); }
      await load();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const handleToggleVaultPermission = async (group: PermissionGroup, vaultId: string) => {
    const current = group.vaultPermissions?.[vaultId]?.read ?? false;
    const next = { ...group.vaultPermissions, [vaultId]: { read: !current } };
    if (!next[vaultId].read) delete next[vaultId];
    try {
      await api.updateGroup(group.id, { vaultPermissions: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, vaultPermissions: next } : g));
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  // Which groups have access to a given vault
  const vaultGroups = (vaultId: string) =>
    groups.filter(g => g.type === 'admin' || g.vaultPermissions?.[vaultId]?.read);

  if (!user) return null;

  return (
    <div className="container">
      {error && <div className="message error show">{error}</div>}

      <div className="section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Vaults</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Store and share information, credentials, and context with workspace participants.
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowCreate(!showCreate)} style={{ whiteSpace: 'nowrap' }}>
              {showCreate ? 'Cancel' : 'New vault'}
            </button>
          )}
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={handleCreate} style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="vault-name" style={{ fontSize: '0.8rem' }}>Name</label>
              <input id="vault-name" type="text" placeholder="e.g. Linear API Key" value={newName} onChange={e => setNewName(e.target.value)} required style={{ marginBottom: 0 }} />
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="vault-desc" style={{ fontSize: '0.8rem' }}>Description</label>
              <input id="vault-desc" type="text" placeholder="What this vault contains and when to use it" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ marginBottom: 0 }} />
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="vault-content" style={{ fontSize: '0.8rem' }}>Content</label>
              <textarea
                id="vault-content"
                placeholder="API key, JSON config, instructions, or any text"
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                rows={4}
                style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: '0.85rem', width: '100%', resize: 'vertical' }}
              />
            </div>
            <button type="submit" disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create vault'}
            </button>
          </form>
        )}

        {/* Vault list */}
        {loading ? (
          <div className="loading">Loading...</div>
        ) : vaults.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No vaults yet.{isAdmin ? ' Create one to get started.' : ''}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {vaults.map(vault => {
              const isExpanded = expandedId === vault.id;
              const accessGroups = vaultGroups(vault.id);

              return (
                <div key={vault.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {/* Header row */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : undefined }}
                    onClick={() => handleExpand(vault.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{vault.name}</span>
                      {vault.description && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {vault.description}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      {isAdmin && accessGroups.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                          {accessGroups.map(g => (
                            <span
                              key={g.id}
                              style={{
                                fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '999px',
                                background: g.type === 'admin' ? 'var(--bg-tertiary)' : 'rgba(34,197,94,0.12)',
                                color: g.type === 'admin' ? 'var(--text-secondary)' : 'var(--success-text)',
                              }}
                            >
                              {g.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {isAdmin && (
                        <button className="btn-small btn-delete" onClick={e => { e.stopPropagation(); handleDelete(vault.id); }}>Delete</button>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                      {loadingContent ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading...</p>
                      ) : expandedVault ? (
                        <>
                          {isAdmin ? (
                            <>
                              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.8rem' }}>Name</label>
                                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} style={{ marginBottom: 0 }} />
                              </div>
                              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.8rem' }}>Description</label>
                                <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} style={{ marginBottom: 0 }} />
                              </div>
                              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.8rem' }}>Content</label>
                                <textarea
                                  value={editContent}
                                  onChange={e => setEditContent(e.target.value)}
                                  rows={6}
                                  style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: '0.85rem', width: '100%', resize: 'vertical' }}
                                />
                              </div>
                              <button onClick={handleSave} disabled={saving} style={{ marginBottom: '1rem' }}>
                                {saving ? 'Saving...' : 'Save changes'}
                              </button>

                              {/* Vault permissions per group */}
                              <div style={{ marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Group Access</div>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                  Admins always have access. Toggle read access for other groups.
                                </p>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Group</th>
                                      <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500, width: 60 }}>Read</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {groups.filter(g => g.type !== 'admin').map(g => {
                                      const hasAccess = g.vaultPermissions?.[vault.id]?.read ?? false;
                                      return (
                                        <tr key={g.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                          <td style={{ padding: '0.3rem 0.5rem' }}>{g.name}</td>
                                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                            <input type="checkbox" checked={hasAccess} onChange={() => handleToggleVaultPermission(g, vault.id)}  />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          ) : (
                            /* Non-admin read-only view */
                            <>
                              {expandedVault.description && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{expandedVault.description}</p>
                              )}
                              <pre style={{
                                background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
                                fontSize: '0.85rem', overflowX: 'auto', border: '1px solid var(--border-color)',
                                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                              }}>
                                {expandedVault.content || '(empty)'}
                              </pre>
                            </>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
