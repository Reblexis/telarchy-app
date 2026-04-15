import { useState, useEffect, useCallback, FormEvent, Fragment } from 'react';
import { compare, sortArrow, type SortState } from '../lib/sort';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace, type WorkspaceInfo } from '../hooks/useWorkspace';
import { api, agentApi } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import type { Agent, PermissionGroup, Metric, Vault } from '../types';

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
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
{`curl -X POST -H "Content-Type: application/json" \\
  -d '{"agentId":"my-bot"}' \\
  ${apiBase}/api/agents/register`}
              </pre>
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>2. Check balance and available markets</p>
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/agents/<agent-id>/dashboard`}
              </pre>
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>3. Place a trade</p>
              <pre style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', overflowX: 'auto', border: '1px solid var(--border-color)', margin: 0 }}>
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
  const [agents, setAgents] = useState<Agent[]>(() => cacheGet<Agent[]>('agents') || []);
  const [loading, setLoading] = useState(!cacheGet('agents'));
  const [error, setError] = useState('');
  const [workspaceStats, setWorkspaceStats] = useState<{ tradedVolume: number } | null>(null);

  // Groups state
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [vaultsList, setVaultsList] = useState<Vault[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');
  // Per-group participant search query
  const [agentSearch, setAgentSearch] = useState<Record<string, string>>({});
  // Per-group manual participant ID input
  const [memberInput, setMemberInput] = useState<Record<string, string>>({});

  // Per-agent trade log state (lazy-loaded on row expand)
  interface AgentTrade {
    id: string;
    marketId: string;
    metricName: string | null;
    targetDate: string | null;
    direction: 'higher' | 'lower';
    kind: 'buy' | 'sell';
    shares: number;
    cost: number;
    marketStatus: 'open' | 'resolved' | 'voided';
    createdAt: string;
  }
  interface AgentMarketPnl {
    marketId: string;
    metricId: string;
    metricName: string;
    targetDate: string;
    status: 'open' | 'resolved' | 'voided' | 'closed';
    rangeMin: number;
    rangeMax: number;
    consensus: number | null;
    probabilityHigher: number;
    metricValue: number | null;
    higherShares: number;
    lowerShares: number;
    netCash: number;
    markValueConsensus: number;
    metricPayoutValue: number | null;
    pnlConsensus: number;
    pnlMetric: number | null;
  }
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentTrades, setAgentTrades] = useState<Record<string, AgentTrade[]>>({});
  const [agentMarketPnl, setAgentMarketPnl] = useState<Record<string, AgentMarketPnl[]>>({});
  const [agentExpansionLoading, setAgentExpansionLoading] = useState<string | null>(null);

  const toggleAgentTrades = async (agentId: string) => {
    if (expandedAgentId === agentId) { setExpandedAgentId(null); return; }
    setExpandedAgentId(agentId);
    if (agentTrades[agentId] && agentMarketPnl[agentId]) return;
    setAgentExpansionLoading(agentId);
    try {
      const [trades, pnl] = await Promise.all([
        api.getAgentTrades(agentId) as Promise<AgentTrade[]>,
        api.getAgentMarketPnl(agentId) as Promise<AgentMarketPnl[]>,
      ]);
      setAgentTrades(prev => ({ ...prev, [agentId]: trades }));
      setAgentMarketPnl(prev => ({ ...prev, [agentId]: pnl }));
    } catch (e) {
      console.error('agent expansion:', e);
    } finally {
      setAgentExpansionLoading(null);
    }
  };

  const fmt9 = (n: number | null | undefined) => n === null || n === undefined ? '-' : n.toFixed(9);

  type PnlSortKey = 'metric' | 'target' | 'status' | 'shares' | 'netCash' | 'consensus' | 'pnlConsensus' | 'metricValue' | 'pnlMetric';
  const [pnlSort, setPnlSort] = useState<SortState<PnlSortKey>>({ key: 'target', dir: 'asc' });
  const togglePnlSort = (key: PnlSortKey) =>
    setPnlSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const sortPnlRows = (rows: AgentMarketPnl[]): AgentMarketPnl[] => {
    const keyFn: Record<PnlSortKey, (r: AgentMarketPnl) => unknown> = {
      metric: r => r.metricName.toLowerCase(),
      target: r => r.targetDate,
      status: r => r.status,
      shares: r => r.higherShares + r.lowerShares,
      netCash: r => r.netCash,
      consensus: r => r.consensus ?? -Infinity,
      pnlConsensus: r => r.pnlConsensus,
      metricValue: r => r.metricValue ?? -Infinity,
      pnlMetric: r => r.pnlMetric ?? -Infinity,
    };
    const fn = keyFn[pnlSort.key];
    const out = [...rows].sort((a, b) => compare(fn(a), fn(b)));
    return pnlSort.dir === 'asc' ? out : out.reverse();
  };

  const loadAgents = useCallback(async () => {
    setError('');
    const wsId = workspace?.workspaceId;
    const [data, stats] = await Promise.all([
      api.getAgents().catch((e: Error) => { setError(e.message); return null; }),
      wsId
        ? api.getWorkspaceStats(wsId).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (data) { setAgents(data); cacheSet('agents', data); }
    setWorkspaceStats(stats as { tradedVolume: number } | null);
    setLoading(false);
  }, [workspace]);

  const loadGroups = useCallback(async () => {
    const [groupData, metricData, vaultData] = await Promise.all([
      api.listGroups().catch((e: Error) => { console.error('listGroups:', e); return []; }),
      api.getMetrics().catch((e: Error) => { console.error('getMetrics:', e); return []; }),
      api.listVaults().catch((e: Error) => { console.error('listVaults:', e); return []; }),
    ]);
    setGroups(groupData);
    setMetrics((metricData as Metric[]).filter((m: Metric) => !m.formula || m.formula.trim() === '0'));
    setVaultsList(vaultData ?? []);
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

  const handleToggleVaultPermission = async (group: PermissionGroup, vaultId: string) => {
    const current = group.vaultPermissions?.[vaultId]?.read ?? false;
    const next = { ...group.vaultPermissions, [vaultId]: { read: !current } };
    if (!next[vaultId].read) delete next[vaultId];
    try {
      await api.updateGroup(group.id, { vaultPermissions: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, vaultPermissions: next } : g));
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const isSystemGroup = (type: string) => type === 'public' || type === 'admin' || type === 'trader';

  // Build a lookup: agentId -> list of groups the agent belongs to
  const agentGroups = (agentId: string) =>
    groups.filter(g => g.memberIds.includes(agentId));

  // Groups available to assign (non-public, since public is auto)
  const assignableGroups = groups.filter(g => g.type !== 'public');

  return (
    <>
      <div className="container">
        {error && <div className="message error show">{error}</div>}
        {groupError && <div className="message error show">{groupError}</div>}

        {workspaceStats !== null && (
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
                  {([
                    ['Participant', undefined],
                    ['Groups', undefined],
                    ['Balance', undefined],
                    ['Earned', undefined],
                    ['Spent', undefined],
                    ['PnL', 'Earned - Spent across all trades (does not mark open positions)'],
                    ['Realized', 'Net P&L on resolved markets only (excludes open and voided markets)'],
                    ['PnL @ consensus', 'Sum over all markets: net cash + current LMSR sell proceeds. Marks open positions to market.'],
                    ['PnL @ metric', 'Sum over all markets: net cash + payout if each market settled at the current metric value (or actualValue for resolved markets).'],
                  ] as [string, string | undefined][]).map(([h, tt], i) => (
                    <th
                      key={h}
                      style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: i >= 2 ? 'right' : 'left' }}
                      title={tt}
                    >{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => {
                  const memberOf = agentGroups(agent.id);
                  const notMemberOf = assignableGroups.filter(g => !g.memberIds.includes(agent.id));
                  const isExpanded = expandedAgentId === agent.id;
                  const trades = agentTrades[agent.id];
                  return (
                    <Fragment key={agent.id}>
                    <tr style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span
                          style={{ fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => toggleAgentTrades(agent.id)}
                          title="Show trade log"
                        >{isExpanded ? '▼ ' : '▶ '}{agent.id}</span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {memberOf.map(g => (
                            <span
                              key={g.id}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px',
                                background: g.type === 'admin' ? 'var(--bg-tertiary)' : g.type === 'trader' ? 'rgba(34,197,94,0.12)' : 'var(--bg-secondary)',
                                color: g.type === 'admin' ? 'var(--text-secondary)' : g.type === 'trader' ? 'var(--success-text)' : 'var(--text-secondary)',
                              }}
                            >
                              {g.name}
                              {g.type !== 'public' && (
                                <span
                                  role="button"
                                  style={{ cursor: 'pointer', opacity: 0.6, marginLeft: '0.1rem', fontSize: '0.65rem' }}
                                  title={`Remove from ${g.name}`}
                                  onClick={() => handleRemoveMemberFromGroup(g, agent.id)}
                                >x</span>
                              )}
                            </span>
                          ))}
                          {notMemberOf.length > 0 && (
                            <select
                              style={{
                                fontSize: '0.7rem', padding: '0.1rem 0.2rem', borderRadius: '999px',
                                background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                                border: '1px dashed var(--border-color)', cursor: 'pointer',
                                appearance: 'none', width: '1.4rem', textAlign: 'center',
                              }}
                              value=""
                              title="Add to group"
                              onChange={e => {
                                const groupId = e.target.value;
                                if (!groupId) return;
                                const group = groups.find(g => g.id === groupId);
                                if (group) handleAddMemberToGroup(group, agent.id);
                              }}
                            >
                              <option value="">+</option>
                              {notMemberOf.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>${fmt9(agent.balance)}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--success-text)' }}>${fmt9(agent.earnedBetting)}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: 'var(--error-text)' }}>${fmt9(agent.spentBetting)}</td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: agent.earnedBetting - agent.spentBetting >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {agent.earnedBetting - agent.spentBetting >= 0 ? '+$' : '-$'}{fmt9(Math.abs(agent.earnedBetting - agent.spentBetting))}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: (agent.realizedPnl ?? 0) >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {(agent.realizedPnl ?? 0) >= 0 ? '+$' : '-$'}{fmt9(Math.abs(agent.realizedPnl ?? 0))}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: (agent.pnlConsensus ?? 0) >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {(agent.pnlConsensus ?? 0) >= 0 ? '+$' : '-$'}{fmt9(Math.abs(agent.pnlConsensus ?? 0))}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: (agent.pnlMetric ?? 0) >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                        {(agent.pnlMetric ?? 0) >= 0 ? '+$' : '-$'}{fmt9(Math.abs(agent.pnlMetric ?? 0))}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                        <td colSpan={9} style={{ padding: '0.5rem 1rem 1rem' }}>
                          {agentExpansionLoading === agent.id && !trades ? (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loading…</div>
                          ) : !trades || trades.length === 0 ? (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No trades.</div>
                          ) : (
                          <>
                          {agentMarketPnl[agent.id] && agentMarketPnl[agent.id].length > 0 && (
                            <div style={{ marginBottom: '1rem' }}>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Per-market P&amp;L</div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                    {([
                                      ['metric', 'left', 'Market', undefined],
                                      ['target', 'left', 'Target', undefined],
                                      ['status', 'left', 'Status', undefined],
                                      ['shares', 'right', 'Shares H/L', 'Shares held (higher / lower)'],
                                      ['netCash', 'right', 'Net cash', 'Net cash invested in this market; sum of trade cash flows (only meaningful for open markets)'],
                                      ['consensus', 'right', 'Consensus', 'Current market consensus (AMM); open markets only'],
                                      ['pnlConsensus', 'right', 'PnL @ consensus', 'Unrealized P&L at current AMM prices; open markets only'],
                                      ['metricValue', 'right', 'Metric', 'Current metric total (for resolved markets: actualValue)'],
                                      ['pnlMetric', 'right', 'PnL @ metric / Final', 'Open: P&L if the market resolved at the current metric value. Resolved: final realized earnings for this market.'],
                                    ] as [PnlSortKey, 'left' | 'right', string, string | undefined][]).map(([k, align, label, tt]) => (
                                      <th key={k} style={{ textAlign: align, padding: '0.3rem 0.4rem', fontWeight: 500, cursor: 'pointer', userSelect: 'none' }} onClick={() => togglePnlSort(k)} title={tt}>
                                        {label}{sortArrow(pnlSort.key === k, pnlSort.dir)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortPnlRows(agentMarketPnl[agent.id]).map(r => {
                                    const isOpen = r.status === 'open';
                                    const dash = <span style={{ color: 'var(--text-secondary)' }}>-</span>;
                                    // For resolved markets pnlMetric is the realized earnings
                                    // (net cash + payout at actualValue). Show that as Final.
                                    // For voided markets the pool is refunded, so final is 0.
                                    const finalValue =
                                      r.status === 'resolved' ? r.pnlMetric
                                      : r.status === 'voided' ? 0
                                      : null;
                                    return (
                                    <tr key={r.marketId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      <td style={{ padding: '0.3rem 0.4rem' }}>{r.metricName}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace' }}>{r.targetDate}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', color: 'var(--text-secondary)' }}>{r.status}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>
                                        <span style={{ color: 'var(--success-text)' }}>{fmt9(r.higherShares)}</span>
                                        {' / '}
                                        <span style={{ color: 'var(--error-text)' }}>{fmt9(r.lowerShares)}</span>
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', color: isOpen ? (r.netCash >= 0 ? 'var(--success-text)' : 'var(--error-text)') : undefined }}>
                                        {isOpen ? `${r.netCash >= 0 ? '+' : ''}${fmt9(r.netCash)}` : dash}
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>
                                        {isOpen && r.consensus !== null ? r.consensus.toFixed(9) : dash}
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: isOpen ? (r.pnlConsensus >= 0 ? 'var(--success-text)' : 'var(--error-text)') : undefined }}>
                                        {isOpen ? `${r.pnlConsensus >= 0 ? '+' : ''}${fmt9(r.pnlConsensus)}` : dash}
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{r.metricValue !== null ? r.metricValue.toFixed(9) : dash}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: isOpen
                                        ? (r.pnlMetric === null ? 'var(--text-secondary)' : r.pnlMetric >= 0 ? 'var(--success-text)' : 'var(--error-text)')
                                        : (finalValue === null ? undefined : finalValue >= 0 ? 'var(--success-text)' : 'var(--error-text)') }}>
                                        {isOpen
                                          ? (r.pnlMetric === null ? dash : `${r.pnlMetric >= 0 ? '+' : ''}${fmt9(r.pnlMetric)}`)
                                          : (finalValue === null ? dash : `${finalValue >= 0 ? '+' : ''}${fmt9(finalValue)}`)}
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trades</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 500 }}>When</th>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Market</th>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Target</th>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Side</th>
                                  <th style={{ textAlign: 'right', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Shares</th>
                                  <th style={{ textAlign: 'right', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Cash</th>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 500 }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {trades.map(t => {
                                  const cash = -t.cost;
                                  return (
                                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{new Date(t.createdAt).toLocaleString()}</td>
                                      <td style={{ padding: '0.3rem 0.4rem' }}>{t.metricName ?? t.marketId}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace' }}>{t.targetDate ?? '-'}</td>
                                      <td style={{ padding: '0.3rem 0.4rem' }}>
                                        <span style={{ color: t.direction === 'higher' ? 'var(--success-text)' : 'var(--error-text)' }}>{t.direction}</span>
                                        <span style={{ marginLeft: '0.35rem', color: 'var(--text-secondary)' }}>({t.kind})</span>
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace' }}>{fmt9(t.shares)}</td>
                                      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', color: cash >= 0 ? 'var(--success-text)' : 'var(--error-text)' }}>
                                        {cash >= 0 ? '+' : ''}{fmt9(cash)}
                                      </td>
                                      <td style={{ padding: '0.3rem 0.4rem', color: 'var(--text-secondary)' }}>{t.marketStatus}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}


              </tbody>
            </table>
          </div>
        )}

        {/* Permission Groups (settings only, member management is inline above) */}
        <div className="section">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Permission Groups</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Manage group settings and per-metric permissions. Assign participants to groups using the + button in the table above.
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

          {groups.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No groups yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {groups.map(group => {
                const isExpanded = expandedGroupId === group.id;
                const systemGroup = isSystemGroup(group.type);
                const restrictedMetrics = Object.keys(group.permissions).length;
                const memberCount = group.memberIds.length;

                return (
                  <div key={group.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.75rem', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : undefined }}
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{group.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {memberCount > 0 ? `${memberCount} participant${memberCount !== 1 ? 's' : ''}` : 'empty'}
                          {restrictedMetrics > 0 && ` · ${restrictedMetrics} metric rule${restrictedMetrics !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        {!systemGroup && (
                          <button className="btn-small btn-delete" onClick={e => { e.stopPropagation(); handleDeleteGroup(group.id); }}>Delete</button>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
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
                                      <input type="checkbox" checked={perms.read} onChange={() => handleTogglePermission(group, m.id, 'read')} />
                                    </td>
                                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                      <input type="checkbox" checked={perms.trade} onChange={() => handleTogglePermission(group, m.id, 'trade')} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}

                        {/* Vault Permissions */}
                        {vaultsList.length > 0 && (
                          <>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', marginTop: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vault Permissions</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Vault</th>
                                  <th style={{ textAlign: 'center', padding: '0.3rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500, width: 60 }}>Read</th>
                                </tr>
                              </thead>
                              <tbody>
                                {vaultsList.map(v => {
                                  const hasAccess = group.vaultPermissions?.[v.id]?.read ?? false;
                                  return (
                                    <tr key={v.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      <td style={{ padding: '0.3rem 0.5rem' }}>{v.name}</td>
                                      <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                        <input type="checkbox" checked={hasAccess} onChange={() => handleToggleVaultPermission(group, v.id)} />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
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
