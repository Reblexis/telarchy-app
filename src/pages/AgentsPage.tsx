import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace, type WorkspaceInfo } from '../hooks/useWorkspace';
import { api, agentApi } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import type { Agent, PermissionGroup, Metric } from '../types';

// ─── Operator view ───────────────────────────────────────────────────────────

const STORED_AGENT_KEY = 'watchedAgent';

interface WatchedAgent { id: string; apiKey: string }
interface AgentDashboard { balance: number; markets: { id: string; metricName: string; targetDate: string; consensus: number | null; liquidity: number }[] }
interface Position { marketId: string; higherShares: number; lowerShares: number }

function AgentOperatorPage({ user, hasWorkspace }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  hasWorkspace: boolean;
}) {
  const apiBase = import.meta.env.VITE_API_URL || 'https://api-ksc7usrtbq-uc.a.run.app';

  const [watched, setWatched] = useState<WatchedAgent | null>(() => {
    const stored = localStorage.getItem(STORED_AGENT_KEY);
    if (!stored) return null;
    try { return JSON.parse(stored); } catch { localStorage.removeItem(STORED_AGENT_KEY); return null; }
  });
  const [inputId, setInputId] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    if (!watched) return;
    setLoading(true);
    setError('');
    Promise.all([
      agentApi.getDashboard(watched.id, watched.apiKey),
      agentApi.getPositions(watched.id, watched.apiKey),
    ])
      .then(([dash, pos]) => { setDashboard(dash); setPositions(pos ?? []); })
      .catch((e: Error) => { setError(e.message); setDashboard(null); setPositions([]); })
      .finally(() => setLoading(false));
  }, [watched]);

  const handleWatch = (e: FormEvent) => {
    e.preventDefault();
    const agent: WatchedAgent = { id: inputId.trim(), apiKey: inputKey.trim() };
    localStorage.setItem(STORED_AGENT_KEY, JSON.stringify(agent));
    setWatched(agent);
    setInputId('');
    setInputKey('');
  };

  const handleClear = () => {
    localStorage.removeItem(STORED_AGENT_KEY);
    setWatched(null);
    setDashboard(null);
    setPositions([]);
    setError('');
  };

  return (
    <>
      <div className="container">

        {/* Watch agent */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Watch a participant</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Enter a participant ID and API key to view its live balance, markets, and positions.
            Credentials are stored locally and never sent to our servers except to authenticate with the API.
          </p>

          {!watched ? (
            <form onSubmit={handleWatch} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
                <label htmlFor="agent-id" style={{ fontSize: '0.8rem' }}>Agent ID</label>
                <input id="agent-id" type="text" placeholder="my-trading-bot" value={inputId} onChange={e => setInputId(e.target.value)} required style={{ marginBottom: 0 }} />
              </div>
              <div className="form-group" style={{ flex: 2, minWidth: 260, marginBottom: 0 }}>
                <label htmlFor="agent-key" style={{ fontSize: '0.8rem' }}>API Key</label>
                <input id="agent-key" type="password" placeholder="agnt_…" value={inputKey} onChange={e => setInputKey(e.target.value)} required style={{ marginBottom: 0 }} />
              </div>
              <button type="submit" disabled={!inputId.trim() || !inputKey.trim()} style={{ whiteSpace: 'nowrap' }}>Watch</button>
            </form>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.95rem' }}>{watched.id}</span>
              <button className="btn-small" onClick={handleClear} style={{ fontSize: '0.8rem' }}>Change agent</button>
            </div>
          )}

          {error && <div className="error show" style={{ marginTop: '0.75rem' }}>{error}</div>}

          {watched && loading && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>Loading…</p>}

          {dashboard && (
            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Balance */}
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.3rem' }}>{dashboard.balance} credits</div>
              </div>

              {/* Positions */}
              {positions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open positions</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        {['Market', 'Higher shares', 'Lower shares'].map(h => (
                          <th key={h} style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: h === 'Market' ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(p => (
                        <tr key={p.marketId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.marketId}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>{p.higherShares.toFixed(3)}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>{p.lowerShares.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Available markets */}
              {dashboard.markets.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top markets</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        {['Metric', 'Target', 'Consensus', 'Liquidity'].map(h => (
                          <th key={h} style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.78rem', textAlign: h === 'Metric' ? 'left' : 'right', fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.markets.map(m => (
                        <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.875rem' }}>{m.metricName}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{m.targetDate}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.875rem' }}>{m.consensus !== null ? m.consensus.toFixed(2) : '-'}</td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.875rem' }}>{m.liquidity.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Connecting your bot */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Connecting your bot</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Register via the API (no auth required). Include the returned key in every subsequent request.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>1. Register your agent</p>
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
{`curl -X POST -H "Content-Type: application/json" \\
  -d '{"agentId":"my-bot"}' \\
  ${apiBase}/api/agents/register`}
              </pre>
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>2. Check balance and available markets</p>
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/agents/<agent-id>/dashboard`}
              </pre>
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>3. Place a trade</p>
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
{`curl -X POST -H "X-Agent-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"marketId":"<id>","direction":"higher","amount":10}' \\
  ${apiBase}/api/predictions/trade`}
              </pre>
            </div>
          </div>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            See the full <a href={`${apiBase}/api/help`} target="_blank" rel="noreferrer" style={{ color: 'var(--focus-border)' }}>API reference</a>.
          </p>
        </div>

      </div>
    </>
  );
}

// ─── Admin view (workspace owners / admins) ─────────────────────────────────

function AgentAdminPage({ user, workspace }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  workspace: WorkspaceInfo | null;
}) {
  const isPlatformAdmin = workspace?.workspaceId === 'default';

  const [agents, setAgents] = useState<Agent[]>(() => cacheGet<Agent[]>('agents') || []);
  const [loading, setLoading] = useState(!cacheGet('agents'));
  const [error, setError] = useState('');
  const [workspaceStats, setWorkspaceStats] = useState<{ tradedVolume: number } | null>(null);

  // Groups state
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');
  // Per-group participant search query
  const [agentSearch, setAgentSearch] = useState<Record<string, string>>({});
  // Per-group manual participant ID input
  const [memberInput, setMemberInput] = useState<Record<string, string>>({});

  const loadAgents = useCallback(async () => {
    setError('');
    const wsId = workspace?.workspaceId;
    const [data, stats] = await Promise.all([
      api.getAgents().catch((e: Error) => { setError(e.message); return null; }),
      !isPlatformAdmin && wsId && wsId !== 'default'
        ? api.getWorkspaceStats(wsId).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (data) { setAgents(data); cacheSet('agents', data); }
    setWorkspaceStats(stats as { tradedVolume: number } | null);
    setLoading(false);
  }, [workspace, isPlatformAdmin]);

  const loadGroups = useCallback(async () => {
    const [groupData, metricData] = await Promise.all([
      api.listGroups().catch((e: Error) => { console.error('listGroups:', e); return []; }),
      api.getMetrics().catch((e: Error) => { console.error('getMetrics:', e); return []; }),
    ]);
    setGroups(groupData);
    setMetrics((metricData as Metric[]).filter((m: Metric) => !m.formula || m.formula.trim() === '0'));
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setGroupError('');
    try {
      const created = await api.createGroup(newGroupName.trim()) as PermissionGroup;
      setGroups(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewGroupName('');
      setExpandedGroupId(created.id);
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('Delete this group?')) return;
    try {
      await api.deleteGroup(groupId);
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (expandedGroupId === groupId) setExpandedGroupId(null);
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const handleAddMemberToGroup = async (group: PermissionGroup, memberId: string) => {
    const next = [...new Set([...group.memberIds, memberId])];
    try {
      await api.updateGroup(group.id, { memberIds: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, memberIds: next } : g));
      if (group.type === 'admin') loadAgents();
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const handleRemoveMemberFromGroup = async (group: PermissionGroup, memberId: string) => {
    const next = group.memberIds.filter(a => a !== memberId);
    try {
      await api.updateGroup(group.id, { memberIds: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, memberIds: next } : g));
      if (group.type === 'admin') loadAgents();
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const handleTogglePermission = async (group: PermissionGroup, metricId: string, field: 'read' | 'trade') => {
    const current = group.permissions[metricId] ?? { read: false, trade: false };
    const next = { ...group.permissions, [metricId]: { ...current, [field]: !current[field] } };
    if (!next[metricId].read && !next[metricId].trade) delete next[metricId];
    try {
      await api.updateGroup(group.id, { permissions: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, permissions: next } : g));
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const isSystemGroup = (type: string) => type === 'public' || type === 'admin';

  return (
    <>
      <div className="container">
        {error && <div className="message error show">{error}</div>}

        {!isPlatformAdmin && workspaceStats !== null && (
          <div className="section" style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Traded Volume</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>{workspaceStats.tradedVolume.toFixed(2)} credits</div>
            </div>
          </div>
        )}

        {/* Agents table */}
        {loading ? (
          <div className="loading">Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No participants in this workspace yet.</p></div>
        ) : (
          <div className="section">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  {['Participant', 'Balance', 'Bet Won', 'Bet Spent', 'PnL'].map((h, i) => (
                    <th key={h} style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span style={{ fontWeight: 600 }}>{agent.id}</span>
                      {agent.role === 'admin' && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>admin</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${agent.balance}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>${agent.earnedBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>${agent.spentBetting}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: agent.earnedBetting - agent.spentBetting >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                      {agent.earnedBetting - agent.spentBetting >= 0 ? '+$' : '-$'}{Math.abs(agent.earnedBetting - agent.spentBetting)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Permission Groups */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Permission Groups</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Groups control workspace access for participants. The Admin group grants full access. Public and Admin groups are system groups.
          </p>

          <form onSubmit={handleCreateGroup} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="New group name"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              style={{ flex: 1, minWidth: 180, marginBottom: 0 }}
            />
            <button type="submit" disabled={creatingGroup || !newGroupName.trim()} style={{ whiteSpace: 'nowrap' }}>
              {creatingGroup ? 'Creating…' : 'New group'}
            </button>
          </form>
          {groupError && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{groupError}</div>}

          {groups.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No groups yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {groups.map(group => {
                const isExpanded = expandedGroupId === group.id;
                const systemGroup = isSystemGroup(group.type);
                const restrictedMetrics = Object.keys(group.permissions).length;
                const query = agentSearch[group.id] ?? '';
                const groupMemberIds = group.memberIds;
                const memberSet = new Set(groupMemberIds);
                const nonMembers = agents.filter(a => !memberSet.has(a.id) && a.id.toLowerCase().includes(query.toLowerCase()));
                const members = agents.filter(a => memberSet.has(a.id));

                return (
                  <div key={group.id} style={{ border: '1px solid var(--border-color)', borderRadius: '0.375rem', overflow: 'hidden' }}>
                    {/* Header */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : undefined }}
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{group.name}</span>
                          {group.description && (
                            <span style={{ marginLeft: '0.6rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{group.description}</span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {group.type === 'public' ? 'workspace members' : (
                            groupMemberIds.length > 0
                              ? `${groupMemberIds.length} participant${groupMemberIds.length !== 1 ? 's' : ''}`
                              : 'empty'
                          )}
                          {restrictedMetrics > 0 && ` · ${restrictedMetrics} metric${restrictedMetrics !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        {!systemGroup && (
                          <button className="btn-small btn-delete" onClick={e => { e.stopPropagation(); handleDeleteGroup(group.id); }}>
                            Delete
                          </button>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                        {/* Participants */}
                        {group.type !== 'public' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Participants</div>
                              {members.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '0.6rem' }}>
                                  {members.map(a => (
                                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem' }}>
                                      <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{a.id}</span>
                                      <button className="btn-small btn-delete" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }} onClick={() => handleRemoveMemberFromGroup(group, a.id)}>Remove</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <input
                                type="text"
                                placeholder="Search workspace participants to add…"
                                value={query}
                                onChange={e => setAgentSearch(prev => ({ ...prev, [group.id]: e.target.value }))}
                                style={{ width: '100%', marginBottom: query ? '0.3rem' : 0 }}
                                onClick={e => e.stopPropagation()}
                              />
                              {query && nonMembers.length === 0 && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>No matching participants.</p>
                              )}
                              {nonMembers.slice(0, 8).map(a => (
                                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{a.id}</span>
                                  <button className="btn-small" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }} onClick={() => { handleAddMemberToGroup(group, a.id); setAgentSearch(prev => ({ ...prev, [group.id]: '' })); }}>Add</button>
                                </div>
                              ))}
                              <div style={{ display: 'flex', gap: '0.4rem' }} onClick={e => e.stopPropagation()}>
                                <input
                                  type="text"
                                  placeholder="Participant ID…"
                                  value={memberInput[group.id] ?? ''}
                                  onChange={e => setMemberInput(prev => ({ ...prev, [group.id]: e.target.value }))}
                                  style={{ flex: 1, marginBottom: 0, fontFamily: 'monospace', fontSize: '0.8rem' }}
                                />
                                <button
                                  className="btn-small"
                                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                                  disabled={!(memberInput[group.id] ?? '').trim()}
                                  onClick={() => {
                                    handleAddMemberToGroup(group, (memberInput[group.id] ?? '').trim());
                                    setMemberInput(prev => ({ ...prev, [group.id]: '' }));
                                  }}
                                >
                                  Add by ID
                                </button>
                              </div>
                            </div>

                          </div>
                        )}

                        {/* Metric permissions */}
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric Permissions</div>
                          {metrics.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No leaf metrics.</p>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Metric</th>
                                  <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500, width: 60 }}>Read</th>
                                  <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500, width: 60 }}>Trade</th>
                                </tr>
                              </thead>
                              <tbody>
                                {metrics.map(m => {
                                  const perms = group.permissions[m.id] ?? { read: false, trade: false };
                                  return (
                                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      <td style={{ padding: '0.3rem 0.5rem' }}>{m.name}</td>
                                      <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                        <input type="checkbox" checked={perms.read} onChange={() => handleTogglePermission(group, m.id, 'read')} style={{ width: 'auto' }} />
                                      </td>
                                      <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                        <input type="checkbox" checked={perms.trade} onChange={() => handleTogglePermission(group, m.id, 'trade')} style={{ width: 'auto' }} />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main export: routes to correct view based on workspace state ────────────

export function AgentsPage() {
  const { user } = useAuth();
  const { workspace, loading } = useWorkspace(!!user);
  const [params] = useSearchParams();
  const forceOperator = params.get('view') === 'operator';

  if (!user || loading) return <div className="loading">Loading…</div>;

  const hasWorkspace = !workspace?.needsWorkspace;

  if (workspace?.needsWorkspace || forceOperator) {
    return <AgentOperatorPage user={user} hasWorkspace={hasWorkspace} />;
  }
  return <AgentAdminPage user={user} workspace={workspace} />;
}
