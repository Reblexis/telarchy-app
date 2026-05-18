import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import type { Source, PermissionGroup, GitHubTreeEntry } from '../types';

interface GitHubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
}

export function SourcesPage() {
  const { user } = useAuth();
  const { workspace } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();

  const [sources, setSources] = useState<Source[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Text source create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);

  // Expanded source (view/edit for text, browse for github)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<Source | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  // GitHub browse state
  const [browsePath, setBrowsePath] = useState<string[]>([]);
  const [treeEntries, setTreeEntries] = useState<GitHubTreeEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  // GitHub repo picker state (survives auth resolution via sessionStorage)
  const [flowState, setFlowState] = useState<string | null>(() => sessionStorage.getItem('gh_source_state'));
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [installationUrl, setInstallationUrl] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [repoSearch, setRepoSearch] = useState('');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const [sourceData, groupData] = await Promise.all([
      api.listSources().catch((e: Error) => { setError(e.message); return []; }),
      isAdmin ? api.listGroups().catch(() => []) : Promise.resolve([]),
    ]);
    setSources((sourceData ?? []) as Source[]);
    setGroups(groupData ?? []);
    setLoading(false);
  }, [user, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const fetchRepos = useCallback(async (state: string) => {
    setLoadingRepos(true);
    try {
      const data = await api.getGitHubRepos(state) as { installationUrl: string; repos: GitHubRepo[] };
      setRepos(data.repos);
      setInstallationUrl(data.installationUrl);
    } catch (e: unknown) {
      setError((e as Error).message);
      sessionStorage.removeItem('gh_source_state');
      setFlowState(null);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const handledStateRef = useRef<string | null>(null);
  useEffect(() => {
    const state = searchParams.get('state');
    if (!state || handledStateRef.current === state) return;
    handledStateRef.current = state;
    sessionStorage.setItem('gh_source_state', state);
    setFlowState(state);
    setSearchParams({}, { replace: true });
    fetchRepos(state);
  }, [searchParams, setSearchParams, fetchRepos]);

  useEffect(() => {
    if (!flowState || repos.length > 0 || loadingRepos) return;
    if (handledStateRef.current === flowState) return;
    fetchRepos(flowState);
  }, [flowState, repos.length, loadingRepos, fetchRepos]);

  const handleRefreshRepos = () => {
    if (flowState) fetchRepos(flowState);
  };

  const handleConnectGitHub = () => {
    const base = import.meta.env.VITE_API_URL || '';
    const wid = workspace?.workspaceId;
    const qs = wid ? `?workspaceId=${encodeURIComponent(wid)}` : '';
    window.location.href = `${base}/api/sources/github/install${qs}`;
  };

  const handleToggleRepo = (fullName: string) => {
    setSelectedRepos(prev => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  const handleConnectSelected = async () => {
    if (!flowState || selectedRepos.size === 0) return;
    setConnecting(true);
    setError('');
    try {
      await api.connectGitHub({ state: flowState, repos: [...selectedRepos] });
      sessionStorage.removeItem('gh_source_state');
      setFlowState(null);
      setRepos([]);
      setSelectedRepos(new Set());
      await load();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const handleCancelRepoPicker = () => {
    sessionStorage.removeItem('gh_source_state');
    setFlowState(null);
    setRepos([]);
    setSelectedRepos(new Set());
  };

  const loadTree = async (sourceId: string, path: string) => {
    setLoadingTree(true);
    setFileContent(null);
    setFilePath(null);
    try {
      const entries = await api.getSourceTree(sourceId, path || undefined) as GitHubTreeEntry[];
      setTreeEntries(entries);
    } catch (e: unknown) {
      setError((e as Error).message);
      setTreeEntries([]);
    } finally {
      setLoadingTree(false);
    }
  };

  const handleExpand = async (source: Source) => {
    if (expandedId === source.id) {
      setExpandedId(null);
      setExpandedSource(null);
      setBrowsePath([]);
      setTreeEntries([]);
      setFileContent(null);
      setFilePath(null);
      return;
    }
    setExpandedId(source.id);
    setExpandedSource(null);
    setBrowsePath([]);
    setFileContent(null);
    setFilePath(null);

    if (source.type === 'text') {
      setLoadingContent(true);
      try {
        const full = await api.getSource(source.id) as Source;
        setExpandedSource(full);
        setEditName(full.name);
        setEditDesc(full.description);
        setEditContent(full.content ?? '');
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoadingContent(false);
      }
    } else {
      setExpandedSource(source);
      await loadTree(source.id, '');
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await api.createTextSource({ name: newName.trim(), description: newDesc.trim(), content: newContent });
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
    if (!expandedId || !expandedSource) return;
    setSaving(true);
    setError('');
    try {
      const body: { name: string; description: string; content?: string } = {
        name: editName.trim(),
        description: editDesc.trim(),
      };
      if (expandedSource.type === 'text') body.content = editContent;
      await api.updateSource(expandedId, body);
      await load();
      const full = await api.getSource(expandedId) as Source;
      setExpandedSource(full);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (source: Source) => {
    const label = source.type === 'github' ? 'Disconnect this GitHub source?' : 'Delete this source?';
    if (!confirm(`${label} This cannot be undone.`)) return;
    setError('');
    try {
      await api.deleteSource(source.id);
      if (expandedId === source.id) {
        setExpandedId(null);
        setExpandedSource(null);
        setBrowsePath([]);
        setTreeEntries([]);
      }
      await load();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const handleNavigateDir = async (dir: string) => {
    if (!expandedId) return;
    const newPath = [...browsePath, dir];
    setBrowsePath(newPath);
    await loadTree(expandedId, newPath.join('/'));
  };

  const handleNavigateUp = async () => {
    if (!expandedId || browsePath.length === 0) return;
    const newPath = browsePath.slice(0, -1);
    setBrowsePath(newPath);
    await loadTree(expandedId, newPath.join('/'));
  };

  const handleOpenFile = async (path: string) => {
    if (!expandedId) return;
    setLoadingFile(true);
    setFileContent(null);
    setFilePath(path);
    try {
      const data = await api.getSourceFile(expandedId, path) as { path: string; content: string };
      setFileContent(data.content);
    } catch (e: unknown) {
      setError((e as Error).message);
      setFileContent(null);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleBackToTree = () => {
    setFileContent(null);
    setFilePath(null);
  };

  const handleToggleSourcePermission = async (group: PermissionGroup, sourceId: string) => {
    const current = group.sourcePermissions?.[sourceId]?.read ?? false;
    const next = { ...group.sourcePermissions, [sourceId]: { read: !current } };
    if (!next[sourceId].read) delete next[sourceId];
    try {
      await api.updateGroup(group.id, { sourcePermissions: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, sourcePermissions: next } : g));
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const sourceGroups = (sourceId: string) =>
    groups.filter(g => g.type === 'admin' || g.sourcePermissions?.[sourceId]?.read);

  const filteredRepos = repoSearch
    ? repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  if (!user) return null;

  return (
    <div className="container">
      {error && <div className="message error show">{error}</div>}

      {flowState && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)', padding: '1.5rem',
            width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Select repositories to connect</h3>
              <button type="button" className="btn-small" onClick={handleCancelRepoPicker}>Cancel</button>
            </div>
            {loadingRepos ? (
              <div className="loading">Loading repositories...</div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Filter repositories..."
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />
                <div style={{ overflowY: 'auto', flex: 1, marginBottom: '0.75rem' }}>
                  {filteredRepos.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No repositories found.</p>
                  ) : (
                    filteredRepos.map(repo => {
                      const isSelected = selectedRepos.has(repo.fullName);
                      return (
                        <div
                          key={repo.fullName}
                          onClick={() => handleToggleRepo(repo.fullName)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.5rem 0.75rem', marginBottom: '0.25rem',
                            border: `1px solid ${isSelected ? 'var(--accent-color, #3b82f6)' : 'var(--border-color)'}`,
                            borderRadius: 'var(--radius-md)',
                            background: isSelected ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleRepo(repo.fullName)}
                            onClick={e => e.stopPropagation()}
                            style={{ flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                              {repo.fullName}
                              {repo.private && (
                                <span style={{
                                  fontSize: '0.65rem', marginLeft: '0.5rem', padding: '0.1rem 0.3rem',
                                  borderRadius: '999px', background: 'rgba(234,179,8,0.15)', color: 'var(--warning-text, #ca8a04)',
                                }}>
                                  private
                                </span>
                              )}
                            </div>
                            {repo.description && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {repo.description}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: selectedRepos.size > 0 ? '0.5rem' : 0 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {installationUrl && (
                      <a href={installationUrl} target="_blank" rel="noopener noreferrer">
                        Manage repository access
                      </a>
                    )}
                  </div>
                  <button type="button" className="btn-small" onClick={handleRefreshRepos} disabled={loadingRepos}>
                    {loadingRepos ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                {selectedRepos.size > 0 && (
                  <button onClick={handleConnectSelected} disabled={connecting}>
                    {connecting ? 'Connecting...' : `Connect ${selectedRepos.size} repo${selectedRepos.size > 1 ? 's' : ''}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="section-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>Sources</h2>
          <p className="section-subtitle">
            Text snippets and live external bridges (GitHub repos) available to workspace participants.
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setShowCreate(!showCreate)} style={{ whiteSpace: 'nowrap' }}>
              {showCreate ? 'Cancel' : 'New text source'}
            </button>
            <button onClick={handleConnectGitHub} style={{ whiteSpace: 'nowrap' }}>
              Connect GitHub
            </button>
          </div>
        )}
      </div>

      <div className="section">

        {showCreate && (
          <form onSubmit={handleCreate} style={{ marginBottom: '1.25rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="source-name" style={{ fontSize: '0.8rem' }}>Name</label>
              <input id="source-name" type="text" placeholder="e.g. Linear API Key" value={newName} onChange={e => setNewName(e.target.value)} required style={{ marginBottom: 0 }} />
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="source-desc" style={{ fontSize: '0.8rem' }}>Description</label>
              <input id="source-desc" type="text" placeholder="What this source contains and when to use it" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ marginBottom: 0 }} />
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="source-content" style={{ fontSize: '0.8rem' }}>Content</label>
              <textarea
                id="source-content"
                placeholder="API key, JSON config, instructions, or any text"
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                rows={4}
                style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: '0.85rem', width: '100%', resize: 'vertical' }}
              />
            </div>
            <button type="submit" disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create source'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="loading">Loading...</div>
        ) : sources.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No sources yet.{isAdmin ? ' Create a text source or connect a GitHub repo to get started.' : ''}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sources.map(source => {
              const isExpanded = expandedId === source.id;
              const accessGroups = sourceGroups(source.id);
              const typeLabel = source.type === 'github' ? 'GH' : 'TXT';

              return (
                <div key={source.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : undefined }}
                    onClick={() => handleExpand(source)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <span style={{ fontSize: '0.7rem', opacity: 0.6, fontFamily: 'monospace', minWidth: '1.8rem' }}>{typeLabel}</span>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{source.name}</span>
                      {source.description && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {source.description}
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
                        <button className="btn-small btn-delete" onClick={e => { e.stopPropagation(); handleDelete(source); }}>
                          {source.type === 'github' ? 'Disconnect' : 'Delete'}
                        </button>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                      {source.type === 'text' ? (
                        loadingContent ? (
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading...</p>
                        ) : expandedSource ? (
                          isAdmin ? (
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

                              <GroupAccessTable
                                groups={groups}
                                sourceId={source.id}
                                onToggle={handleToggleSourcePermission}
                              />
                            </>
                          ) : (
                            <>
                              {expandedSource.description && (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{expandedSource.description}</p>
                              )}
                              <pre style={{
                                background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
                                fontSize: '0.85rem', overflowX: 'auto', border: '1px solid var(--border-color)',
                                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                              }}>
                                {expandedSource.content || '(empty)'}
                              </pre>
                            </>
                          )
                        ) : null
                      ) : (
                        <>
                          {filePath && fileContent !== null ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <button type="button" className="btn-small" onClick={handleBackToTree}>Back</button>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{filePath}</span>
                              </div>
                              <pre style={{
                                background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
                                fontSize: '0.8rem', overflowX: 'auto', border: '1px solid var(--border-color)',
                                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '60vh',
                              }}>
                                {fileContent}
                              </pre>
                            </div>
                          ) : loadingFile ? (
                            <div className="loading" style={{ fontSize: '0.875rem' }}>Loading file...</div>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                {browsePath.length > 0 && (
                                  <button type="button" className="btn-small" onClick={handleNavigateUp}>Up</button>
                                )}
                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                  /{browsePath.join('/')}
                                </span>
                              </div>
                              {loadingTree ? (
                                <div className="loading" style={{ fontSize: '0.875rem' }}>Loading...</div>
                              ) : treeEntries.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Empty directory.</p>
                              ) : (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: isAdmin ? '1rem' : 0 }}>
                                  {treeEntries
                                    .sort((a, b) => {
                                      if (a.type === b.type) return a.path.localeCompare(b.path);
                                      return a.type === 'dir' ? -1 : 1;
                                    })
                                    .map(entry => {
                                      const name = entry.path.split('/').pop() || entry.path;
                                      return (
                                        <div
                                          key={entry.path}
                                          onClick={() => entry.type === 'dir' ? handleNavigateDir(name) : handleOpenFile(entry.path)}
                                          style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            padding: '0.35rem 0.75rem', cursor: 'pointer',
                                            borderBottom: '1px solid var(--border-color)',
                                            fontSize: '0.85rem',
                                          }}
                                        >
                                          <span style={{ opacity: 0.5, fontSize: '0.75rem', width: '1.2rem', textAlign: 'center' }}>
                                            {entry.type === 'dir' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
                                          </span>
                                          <span style={{ fontFamily: 'monospace' }}>{name}</span>
                                          {entry.type === 'file' && entry.size !== undefined && (
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                              {entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              )}

                              {isAdmin && (
                                <GroupAccessTable
                                  groups={groups}
                                  sourceId={source.id}
                                  onToggle={handleToggleSourcePermission}
                                />
                              )}
                            </div>
                          )}
                        </>
                      )}
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

function GroupAccessTable({
  groups,
  sourceId,
  onToggle,
}: {
  groups: PermissionGroup[];
  sourceId: string;
  onToggle: (group: PermissionGroup, sourceId: string) => void;
}) {
  return (
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
            const hasAccess = g.sourcePermissions?.[sourceId]?.read ?? false;
            return (
              <tr key={g.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '0.3rem 0.5rem' }}>{g.name}</td>
                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                  <input type="checkbox" checked={hasAccess} onChange={() => onToggle(g, sourceId)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
