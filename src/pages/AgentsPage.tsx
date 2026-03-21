import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { Header } from '../components/Header';
import type { Agent, PermissionGroup, Metric } from '../types';

// ─── Operator view (agent operators with no workspace) ──────────────────────

interface MyAgent {
  id: string;
  role: string;
  balance: number;
  earnedBetting: number;
  spentBetting: number;
  createdAt?: { _seconds: number } | null;
}

function AgentOperatorPage({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const navigate = useNavigate();

  const [myAgents, setMyAgents] = useState<MyAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentId, setAgentId] = useState('');
  const [newKey, setNewKey] = useState<{ agentId: string; apiKey: string } | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const loadMyAgents = useCallback(async () => {
    setLoadingAgents(true);
    const data = await api.getMyAgents(user).catch((e: Error) => { console.error('getMyAgents', e.message); return []; });
    setMyAgents(data);
    setLoadingAgents(false);
  }, [user]);

  useEffect(() => { loadMyAgents(); }, [loadMyAgents]);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    const id = agentId.trim();
    if (!id) return;
    setRegistering(true);
    try {
      const result = await api.registerAgent(user, id);
      setNewKey(result);
      setAgentId('');
      loadMyAgents();
    } catch (err: unknown) {
      setRegisterError((err as Error).message || 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const apiBase = import.meta.env.VITE_API_URL || 'https://api-ksc7usrtbq-uc.a.run.app';

  return (
    <>
      <Header activePage="agents" navMode="operator" actions={
        <button className="logout-btn" onClick={async () => { await user.reload().catch(() => {}); navigate('/login'); }}>
          Logout
        </button>
      } />
      <div className="container">

        {/* My Agents */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>My agents</h2>
          {loadingAgents ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
          ) : myAgents.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No agents registered yet. Register your first agent below.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  {['Agent ID', 'Status', 'Balance', 'Won', 'Spent', 'PnL'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: h === 'Agent ID' || h === 'Status' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myAgents.map(a => {
                  const pnl = a.earnedBetting - a.spentBetting;
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600, fontFamily: 'monospace', fontSize: '0.9rem' }}>{a.id}</td>
                      <td style={{ padding: '0.6rem 0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                          background: a.role === 'agent' ? 'var(--success-bg)' : 'var(--bg-tertiary)',
                          color: a.role === 'agent' ? 'var(--success-text)' : 'var(--text-secondary)',
                        }}>
                          {a.role === 'pending' ? 'awaiting approval' : a.role}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${a.balance}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>${a.earnedBetting}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>${a.spentBetting}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: pnl >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Register new agent */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Register a new agent</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Choose a unique ID for your bot. You'll get an API key to include in its requests. The key is only shown once.
          </p>
          <form onSubmit={handleRegister} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                placeholder="e.g. my-trading-bot"
                value={agentId}
                onChange={e => setAgentId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                pattern="[a-z0-9\-_]+"
                title="Lowercase letters, numbers, hyphens and underscores only"
                required
                style={{ marginBottom: 0 }}
              />
            </div>
            <button type="submit" disabled={registering || !agentId.trim()} style={{ whiteSpace: 'nowrap' }}>
              {registering ? 'Registering…' : 'Register agent'}
            </button>
          </form>
          {registerError && <div className="error show" style={{ marginTop: '0.5rem' }}>{registerError}</div>}

          {newKey && (
            <div style={{
              marginTop: '1rem', padding: '1rem', borderRadius: '0.5rem',
              background: 'var(--success-bg)', border: '1px solid var(--success-text)',
            }}>
              <p style={{ fontWeight: 600, color: 'var(--success-text)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                Agent <code>{newKey.agentId}</code> registered. Copy your API key — it won't be shown again.
              </p>
              <code style={{
                display: 'block', padding: '0.6rem 0.75rem',
                background: 'var(--bg-primary)', borderRadius: '0.375rem',
                fontSize: '0.8rem', wordBreak: 'break-all', userSelect: 'all',
                border: '1px solid var(--border-color)',
              }}>
                {newKey.apiKey}
              </code>
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Status: <strong>pending</strong> — a workspace admin must approve your agent before it can trade.
                Browse the <Link to="/marketplace">Marketplace</Link> to find public workspaces to join.
              </p>
              <button className="btn-small" style={{ marginTop: '0.5rem' }} onClick={() => setNewKey(null)}>Dismiss</button>
            </div>
          )}
        </div>

        {/* How to use your agent */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Connecting your bot</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Include the API key in every request using the <code>X-Agent-Key</code> header.
            Your agent must be approved by the workspace admin before it can place trades.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>1. Check balance and available markets</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/agents/<agent-id>/dashboard`}
              </pre>
            </div>

            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>2. Place a trade</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -X POST -H "X-Agent-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"marketId":"<id>","prediction":0.72,"stake":10}' \\
  ${apiBase}/api/predictions/trade`}
              </pre>
            </div>

            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>3. Check your positions</p>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '0.75rem 1rem',
                borderRadius: '0.375rem', fontSize: '0.78rem', overflowX: 'auto',
                border: '1px solid var(--border-color)', margin: 0,
              }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/predictions/positions`}
              </pre>
            </div>
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Deposit credits: send USDC on Base to the treasury, then call{' '}
            <code>POST /api/agents/&lt;id&gt;/deposit</code> with the tx hash.
            See the full <a href={`${apiBase}/api/help`} target="_blank" rel="noreferrer" style={{ color: 'var(--focus-border)' }}>API reference</a>.
          </p>
        </div>

        {/* Find markets */}
        <div className="section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Find markets to trade</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Browse public workspaces, see active markets, and request to join.
            </p>
          </div>
          <Link to="/marketplace" style={{
            background: 'var(--button-bg)', color: 'var(--button-text)',
            padding: '0.5rem 1.1rem', borderRadius: '0.375rem',
            textDecoration: 'none', fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap',
          }}>
            Browse Marketplace →
          </Link>
        </div>
      </div>
    </>
  );
}

// ─── Admin view (workspace owners / admins) ─────────────────────────────────

function AgentAdminPage({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const [agents, setAgents] = useState<Agent[]>(() => cacheGet<Agent[]>('agents') || []);
  const [loading, setLoading] = useState(!cacheGet('agents'));
  const [error, setError] = useState('');
  const [treasury, setTreasury] = useState<{ address: string; usdcBalance: number; ethBalance: number } | null>(null);

  // Groups state
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');
  // Per-group agent search query
  const [agentSearch, setAgentSearch] = useState<Record<string, string>>({});

  const loadAgents = useCallback(async () => {
    setError('');
    const [data, treas] = await Promise.all([
      api.getAgents(user).catch((e: Error) => { setError(e.message); return null; }),
      api.getTreasury(user).catch(() => null),
    ]);
    if (data) { setAgents(data); cacheSet('agents', data); }
    if (treas) setTreasury(treas);
    setLoading(false);
  }, [user]);

  const loadGroups = useCallback(async () => {
    const [groupData, metricData] = await Promise.all([
      api.listGroups(user).catch((e: Error) => { console.error('listGroups:', e); return []; }),
      api.getMetrics(user).catch((e: Error) => { console.error('getMetrics:', e); return []; }),
    ]);
    setGroups(groupData);
    setMetrics((metricData as Metric[]).filter((m: Metric) => !m.formula || m.formula.trim() === '0'));
  }, [user]);

  useEffect(() => { loadAgents(); }, [loadAgents]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setGroupError('');
    try {
      const created = await api.createGroup(user, newGroupName.trim()) as PermissionGroup;
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
    await api.deleteGroup(user, groupId).catch((e: Error) => console.error('deleteGroup:', e));
    setGroups(prev => prev.filter(g => g.id !== groupId));
    if (expandedGroupId === groupId) setExpandedGroupId(null);
  };

  const handleAddAgentToGroup = async (group: PermissionGroup, agentId: string) => {
    const next = [...new Set([...group.agentIds, agentId])];
    await api.updateGroup(user, group.id, { agentIds: next }).catch((e: Error) => console.error('updateGroup:', e));
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, agentIds: next } : g));
    // Also refresh agent list if admin role changed
    if (group.type === 'admin') loadAgents();
  };

  const handleRemoveAgentFromGroup = async (group: PermissionGroup, agentId: string) => {
    const next = group.agentIds.filter(a => a !== agentId);
    await api.updateGroup(user, group.id, { agentIds: next }).catch((e: Error) => console.error('updateGroup:', e));
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, agentIds: next } : g));
    if (group.type === 'admin') loadAgents();
  };

  const handleTogglePermission = async (group: PermissionGroup, metricId: string, field: 'read' | 'trade') => {
    const current = group.permissions[metricId] ?? { read: false, trade: false };
    const next = { ...group.permissions, [metricId]: { ...current, [field]: !current[field] } };
    if (!next[metricId].read && !next[metricId].trade) delete next[metricId];
    await api.updateGroup(user, group.id, { permissions: next }).catch((e: Error) => console.error('updateGroup:', e));
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, permissions: next } : g));
  };

  const isSystemGroup = (type: string) => type === 'public' || type === 'admin';

  return (
    <>
      <Header activePage="agents" navMode="creator" />
      <div className="container">
        {error && <div className="message error show">{error}</div>}
        {treasury && (
          <div className="section" style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Treasury USDC (Base)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>${treasury.usdcBalance.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Treasury ETH (Base)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>{treasury.ethBalance.toFixed(6)} ETH</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Address</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{treasury.address}</div>
            </div>
          </div>
        )}

        {/* Agents table */}
        {loading ? (
          <div className="loading">Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="section"><p style={{ color: 'var(--text-secondary)' }}>No agents registered yet.</p></div>
        ) : (
          <div className="section">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                  {['Agent', 'Balance', 'Bet Won', 'Bet Spent', 'PnL'].map((h, i) => (
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
            Groups control which agents can read or trade individual leaf metrics. Public and Admin groups are system groups.
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
                const memberSet = new Set(group.agentIds);
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
                          {group.type === 'public' ? 'all agents' : `${group.agentIds.length} agent${group.agentIds.length !== 1 ? 's' : ''}`}
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

                        {/* Agents */}
                        {group.type !== 'public' && (
                          <div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Members</div>
                            {members.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '0.6rem' }}>
                                {members.map(a => (
                                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.25rem' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{a.id}</span>
                                    <button className="btn-small btn-delete" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }} onClick={() => handleRemoveAgentFromGroup(group, a.id)}>Remove</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <input
                              type="text"
                              placeholder="Search agents to add…"
                              value={query}
                              onChange={e => setAgentSearch(prev => ({ ...prev, [group.id]: e.target.value }))}
                              style={{ width: '100%', marginBottom: query ? '0.3rem' : 0 }}
                              onClick={e => e.stopPropagation()}
                            />
                            {query && nonMembers.length === 0 && (
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>No matching agents.</p>
                            )}
                            {nonMembers.slice(0, 8).map(a => (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{a.id}</span>
                                <button className="btn-small" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }} onClick={() => { handleAddAgentToGroup(group, a.id); setAgentSearch(prev => ({ ...prev, [group.id]: '' })); }}>Add</button>
                              </div>
                            ))}
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

// ─── Main export — routes to correct view based on workspace state ───────────

export function AgentsPage() {
  const { user } = useAuth();
  const { workspace, loading } = useWorkspace(user);

  if (!user || loading) return <div className="loading">Loading…</div>;

  if (workspace?.needsWorkspace) {
    return <AgentOperatorPage user={user} />;
  }
  return <AgentAdminPage user={user} />;
}
