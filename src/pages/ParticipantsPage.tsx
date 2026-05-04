import { useState, useEffect, useCallback, FormEvent, Fragment } from 'react';
import { compare, sortArrow, type SortState } from '../lib/sort';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace, type WorkspaceInfo } from '../hooks/useWorkspace';
import { api, agentApi } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import type { Agent, PermissionGroup, Metric, Source, Capability } from '../types';

// ─── Shared formatters ───────────────────────────────────────────────────────

const fmt9 = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '-'
    : n.toLocaleString('en-US', { minimumFractionDigits: 9, maximumFractionDigits: 9 });

const fmt2 = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '-'
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Heuristic: opaque IDs (long random-looking strings) render in monospace
// so human-readable names stay in the UI font.
const isOpaqueId = (id: string) => id.length > 18 && !/\s/.test(id) && /^[a-zA-Z0-9_-]+$/.test(id);

function signed(n: number, fmt: (n: number) => string = fmt9): string {
  return (n >= 0 ? '+' : '-') + fmt(Math.abs(n));
}

function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n >= 0 ? 'agent-num-pos' : 'agent-num-neg';
}

// ─── Operator view ───────────────────────────────────────────────────────────

const STORED_AGENT_KEY = 'watchedAgent';

interface WatchedAgent { id: string; apiKey: string }
interface AgentDashboard { balance: number; markets: { id: string; metricName: string; targetDate: string; consensus: number | null; liquidity: number }[] }
interface Position { marketId: string; higherShares: number; lowerShares: number }

function AgentOperatorPage({ user: _user, hasWorkspace: _hasWorkspace }: {
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
    <div className="container">
      <div className="section">
        <div className="section-header">
          <h2>Watch a participant</h2>
          <p className="section-subtitle">
            Enter a participant ID and API key to view its live balance, markets, and positions.
            Credentials are stored locally and never sent to our servers except to authenticate with the API.
          </p>
        </div>

        {!watched ? (
          <form onSubmit={handleWatch} className="agent-form-inline">
            <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="agent-id" style={{ fontSize: '0.8rem' }}>Participant ID</label>
              <input id="agent-id" type="text" placeholder="my-trading-bot" value={inputId} onChange={e => setInputId(e.target.value)} required style={{ marginBottom: 0 }} />
            </div>
            <div className="form-group" style={{ flex: 2, minWidth: 260 }}>
              <label htmlFor="agent-key" style={{ fontSize: '0.8rem' }}>API key</label>
              <input id="agent-key" type="password" placeholder="agnt_…" value={inputKey} onChange={e => setInputKey(e.target.value)} required style={{ marginBottom: 0 }} />
            </div>
            <button type="submit" disabled={!inputId.trim() || !inputKey.trim()} style={{ whiteSpace: 'nowrap' }}>Watch</button>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span className={isOpaqueId(watched.id) ? 'agent-id agent-id-opaque' : 'agent-id'}>{watched.id}</span>
            <button className="btn-small" onClick={handleClear}>Change participant</button>
          </div>
        )}

        {error && <div className="error show" style={{ marginTop: '0.75rem' }}>{error}</div>}
        {watched && loading && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '1rem' }}>Loading…</p>}

        {dashboard && (
          <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1.5rem' }}>
            <div>
              <div className="section-label">Balance</div>
              <div className="stat-card-value" style={{ fontSize: '1.5rem' }}>{fmt2(dashboard.balance)} <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>credits</span></div>
            </div>

            {positions.length > 0 && (
              <div>
                <div className="section-label">Open positions</div>
                <table className="agent-subtable">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Market</th>
                      <th style={{ textAlign: 'right' }}>Higher shares</th>
                      <th style={{ textAlign: 'right' }}>Lower shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.marketId}>
                        <td><span className="agent-id agent-id-opaque">{p.marketId}</span></td>
                        <td className="agent-num agent-num-pos">{fmt9(p.higherShares)}</td>
                        <td className="agent-num agent-num-neg">{fmt9(p.lowerShares)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {dashboard.markets.length > 0 && (
              <div>
                <div className="section-label">Top markets</div>
                <table className="agent-subtable">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Metric</th>
                      <th style={{ textAlign: 'right' }}>Target</th>
                      <th style={{ textAlign: 'right' }}>Consensus</th>
                      <th style={{ textAlign: 'right' }}>Liquidity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.markets.map(m => (
                      <tr key={m.id}>
                        <td>{m.metricName}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{m.targetDate}</td>
                        <td className="agent-num">{m.consensus !== null ? m.consensus.toFixed(2) : '-'}</td>
                        <td className="agent-num">{m.liquidity.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Connecting your bot</h2>
          <p className="section-subtitle">
            Register via the API (no auth required). Include the returned key in every subsequent request.
          </p>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="agent-code-step">
            <p>1. Register your agent</p>
            <pre>{`curl -X POST -H "Content-Type: application/json" \\
  -d '{"agentId":"my-bot"}' \\
  ${apiBase}/api/agents/register`}</pre>
          </div>
          <div className="agent-code-step">
            <p>2. Check balance and available markets</p>
            <pre>{`curl -H "X-Agent-Key: <your-key>" \\
  ${apiBase}/api/agents/<agent-id>/dashboard`}</pre>
          </div>
          <div className="agent-code-step">
            <p>3. Place a trade</p>
            <pre>{`curl -X POST -H "X-Agent-Key: <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"marketId":"<id>","direction":"higher","amount":10}' \\
  ${apiBase}/api/predictions/trade`}</pre>
          </div>
        </div>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          See the full <a href={`${apiBase}/api/help`} target="_blank" rel="noreferrer">API reference</a>.
        </p>
      </div>
    </div>
  );
}

// ─── Admin view (workspace owners / admins) ─────────────────────────────────

function AgentAdminPage({ user: _user, workspace }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  workspace: WorkspaceInfo | null;
}) {
  const [agents, setAgents] = useState<Agent[]>(() => cacheGet<Agent[]>('agents') || []);
  const [loading, setLoading] = useState(!cacheGet('agents'));
  const [error, setError] = useState('');
  const [workspaceStats, setWorkspaceStats] = useState<{ tradedVolume: number } | null>(null);

  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [sourcesList, setSourcesList] = useState<Source[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');

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

  type PnlSortKey = 'metric' | 'target' | 'status' | 'shares' | 'netCash' | 'consensus' | 'pnlConsensus' | 'metricValue' | 'payout' | 'pnlMetric';
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
      payout: r => r.metricPayoutValue ?? -Infinity,
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
    const [groupData, metricData, sourceData] = await Promise.all([
      api.listGroups().catch((e: Error) => { console.error('listGroups:', e); return []; }),
      api.getMetrics().catch((e: Error) => { console.error('getMetrics:', e); return []; }),
      api.listSources().catch((e: Error) => { console.error('listSources:', e); return []; }),
    ]);
    setGroups(groupData);
    setMetrics((metricData as Metric[]).filter((m: Metric) => !m.formula || m.formula.trim() === '0'));
    setSourcesList((sourceData ?? []) as Source[]);
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

  const handleToggleSourcePermission = async (group: PermissionGroup, sourceId: string) => {
    const current = group.sourcePermissions?.[sourceId]?.read ?? false;
    const next = { ...group.sourcePermissions, [sourceId]: { read: !current } };
    if (!next[sourceId].read) delete next[sourceId];
    try {
      await api.updateGroup(group.id, { sourcePermissions: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, sourcePermissions: next } : g));
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const handleToggleCapability = async (group: PermissionGroup, cap: Capability) => {
    const current = group.capabilities ?? [];
    const next = current.includes(cap) ? current.filter(c => c !== cap) : [...current, cap];
    try {
      await api.updateGroup(group.id, { capabilities: next });
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, capabilities: next } : g));
    } catch (e: unknown) {
      setGroupError((e as Error).message);
    }
  };

  const isSystemGroup = (type: string) => type === 'public' || type === 'admin' || type === 'trader';

  const agentGroups = (agentId: string) =>
    groups.filter(g => g.memberIds.includes(agentId));

  const assignableGroups = groups.filter(g => g.type !== 'public');

  const headers: [string, 'left' | 'right', string | undefined][] = [
    ['Participant', 'left', undefined],
    ['Groups', 'left', undefined],
    ['Balance', 'right', undefined],
    ['Earned', 'right', undefined],
    ['Spent', 'right', undefined],
    ['PnL', 'right', 'Earned - Spent across all trades (does not mark open positions)'],
    ['Realized', 'right', 'Net P&L on resolved markets only (excludes open and voided markets)'],
    ['PnL @ consensus', 'right', 'Sum over all markets: net cash + current LMSR sell proceeds. Marks open positions to market.'],
    ['PnL @ metric', 'right', 'Sum over all markets: net cash + payout if each market settled at the current metric value (or actualValue for resolved markets).'],
  ];

  return (
    <div className="container">
      <div className="section-header">
        <h2>Participants</h2>
        <p className="section-subtitle">
          Every participant in this workspace, human or AI, along with permission groups and the live trade log.
        </p>
      </div>

      {error && <div className="message error show">{error}</div>}
      {groupError && <div className="message error show">{groupError}</div>}

      <div className="agent-stats">
        <div className="section agent-stat-card">
          <div className="stat-card-label">Traded volume</div>
          <div className="stat-card-value">
            {workspaceStats ? `${fmt2(workspaceStats.tradedVolume)}` : '-'}
            <span style={{ fontSize: '0.7em', color: 'var(--text-secondary)', marginLeft: '0.3rem', fontWeight: 400 }}>credits</span>
          </div>
        </div>
        <div className="section agent-stat-card">
          <div className="stat-card-label">Participants</div>
          <div className="stat-card-value">{loading ? '-' : agents.length}</div>
        </div>
        <div className="section agent-stat-card">
          <div className="stat-card-label">Permission groups</div>
          <div className="stat-card-value">{groups.length}</div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Participants</h2>
          <p className="section-subtitle">
            Every human or AI participant in this workspace. Click a row to inspect per-market P&amp;L and the full trade log.
          </p>
        </div>

        {loading ? (
          <div className="loading">Loading participants…</div>
        ) : agents.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No participants in this workspace yet.</p>
        ) : (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th aria-hidden="true" />
                  {headers.map(([h, align, tt]) => (
                    <th key={h} style={{ textAlign: align }} title={tt}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => {
                  const memberOf = agentGroups(agent.id);
                  const notMemberOf = assignableGroups.filter(g => !g.memberIds.includes(agent.id));
                  const isExpanded = expandedAgentId === agent.id;
                  const trades = agentTrades[agent.id];
                  const pnlRows = agentMarketPnl[agent.id];
                  const tradingPnl = agent.earnedBetting - agent.spentBetting;

                  return (
                    <Fragment key={agent.id}>
                      <tr
                        className={`agent-row${isExpanded ? ' expanded' : ''}`}
                        onClick={() => toggleAgentTrades(agent.id)}
                      >
                        <td className="agent-chevron">{isExpanded ? '▾' : '▸'}</td>
                        <td>
                          <span className={isOpaqueId(agent.id) ? 'agent-id agent-id-opaque' : 'agent-id'} title={agent.id}>
                            {agent.id}
                          </span>
                        </td>
                        <td>
                          <div className="agent-groups" onClick={e => e.stopPropagation()}>
                            {memberOf.map(g => (
                              <span key={g.id} className={`agent-chip agent-chip-${g.type === 'admin' || g.type === 'trader' || g.type === 'public' ? g.type : 'custom'}`}>
                                {g.name}
                                {g.type !== 'public' && (
                                  <button
                                    type="button"
                                    className="agent-chip-remove"
                                    title={`Remove from ${g.name}`}
                                    onClick={() => handleRemoveMemberFromGroup(g, agent.id)}
                                  >×</button>
                                )}
                              </span>
                            ))}
                            {notMemberOf.length > 0 && (
                              <select
                                className="agent-add-group"
                                value=""
                                title="Add to group"
                                onChange={e => {
                                  const groupId = e.target.value;
                                  if (!groupId) return;
                                  const group = groups.find(g => g.id === groupId);
                                  if (group) handleAddMemberToGroup(group, agent.id);
                                }}
                              >
                                <option value="">+ add</option>
                                {notMemberOf.map(g => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        <td className="agent-num">${fmt9(agent.balance)}</td>
                        <td className="agent-num agent-num-pos">${fmt9(agent.earnedBetting)}</td>
                        <td className="agent-num agent-num-neg">${fmt9(agent.spentBetting)}</td>
                        <td className={`agent-num agent-num-bold ${tradingPnl >= 0 ? 'agent-num-pos' : 'agent-num-neg'}`}>
                          {signed(tradingPnl, n => `$${fmt9(n)}`)}
                        </td>
                        <td className={`agent-num agent-num-bold ${pnlClass(agent.realizedPnl)}`}>
                          {signed(agent.realizedPnl ?? 0, n => `$${fmt9(n)}`)}
                        </td>
                        <td className={`agent-num agent-num-bold ${pnlClass(agent.pnlConsensus)}`}>
                          {signed(agent.pnlConsensus ?? 0, n => `$${fmt9(n)}`)}
                        </td>
                        <td className={`agent-num agent-num-bold ${pnlClass(agent.pnlMetric)}`}>
                          {signed(agent.pnlMetric ?? 0, n => `$${fmt9(n)}`)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="agent-expanded">
                          <td colSpan={10}>
                            {agentExpansionLoading === agent.id && !trades ? (
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingTop: '0.75rem' }}>Loading…</div>
                            ) : !trades || trades.length === 0 ? (
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingTop: '0.75rem' }}>No trades.</div>
                            ) : (
                              <>
                                {pnlRows && pnlRows.length > 0 && (
                                  <div style={{ marginTop: '1rem' }}>
                                    <div className="section-label">Per-market P&amp;L</div>
                                    <table className="agent-subtable">
                                      <thead>
                                        <tr>
                                          {([
                                            ['metric', 'left', 'Market', undefined],
                                            ['target', 'left', 'Target', undefined],
                                            ['status', 'left', 'Status', undefined],
                                            ['shares', 'right', 'Shares H/L', 'Shares held (higher / lower)'],
                                            ['netCash', 'right', 'Net cash', 'Net cash invested in this market (open markets only)'],
                                            ['consensus', 'right', 'Consensus', 'Current market consensus (open markets only)'],
                                            ['pnlConsensus', 'right', 'PnL @ consensus', 'Unrealized P&L at current AMM prices; open markets only'],
                                            ['metricValue', 'right', 'Metric', 'Current metric total (resolved markets show actualValue)'],
                                            ['payout', 'right', 'Payout', 'Gross payout from shares held at current metric value'],
                                            ['pnlMetric', 'right', 'Gain/Loss', 'Net profit/loss if settled at current metric value'],
                                          ] as [PnlSortKey, 'left' | 'right', string, string | undefined][]).map(([k, align, label, tt]) => (
                                            <th
                                              key={k}
                                              style={{ textAlign: align, cursor: 'pointer', userSelect: 'none' }}
                                              onClick={() => togglePnlSort(k)}
                                              title={tt}
                                            >
                                              {label}{sortArrow(pnlSort.key === k, pnlSort.dir)}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sortPnlRows(pnlRows).map(r => {
                                          const isOpen = r.status === 'open';
                                          const dash = <span style={{ color: 'var(--text-tertiary)' }}>-</span>;
                                          const finalValue =
                                            r.status === 'resolved' ? r.pnlMetric
                                            : r.status === 'voided' ? 0
                                            : null;
                                          return (
                                            <tr key={r.marketId}>
                                              <td>{r.metricName}</td>
                                              <td className="agent-num" style={{ textAlign: 'left' }}>{r.targetDate}</td>
                                              <td style={{ color: 'var(--text-secondary)' }}>{r.status}</td>
                                              <td className="agent-num">
                                                <span className="agent-num-pos">{fmt9(r.higherShares)}</span>
                                                <span style={{ color: 'var(--text-tertiary)' }}> / </span>
                                                <span className="agent-num-neg">{fmt9(r.lowerShares)}</span>
                                              </td>
                                              <td className={`agent-num ${isOpen ? (r.netCash >= 0 ? 'agent-num-pos' : 'agent-num-neg') : ''}`}>
                                                {isOpen ? signed(r.netCash) : dash}
                                              </td>
                                              <td className="agent-num">
                                                {isOpen && r.consensus !== null ? r.consensus.toFixed(9) : dash}
                                              </td>
                                              <td className={`agent-num agent-num-bold ${isOpen ? (r.pnlConsensus >= 0 ? 'agent-num-pos' : 'agent-num-neg') : ''}`}>
                                                {isOpen ? signed(r.pnlConsensus) : dash}
                                              </td>
                                              <td className="agent-num">{r.metricValue !== null ? r.metricValue.toFixed(9) : dash}</td>
                                              <td className="agent-num">{r.status === 'voided' ? dash : (r.metricPayoutValue === null ? dash : fmt9(r.metricPayoutValue))}</td>
                                              <td className={`agent-num agent-num-bold ${isOpen
                                                ? (r.pnlMetric === null ? '' : r.pnlMetric >= 0 ? 'agent-num-pos' : 'agent-num-neg')
                                                : (finalValue === null ? '' : finalValue >= 0 ? 'agent-num-pos' : 'agent-num-neg')}`}>
                                                {isOpen
                                                  ? (r.pnlMetric === null ? dash : signed(r.pnlMetric))
                                                  : (finalValue === null ? dash : signed(finalValue))}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                <div style={{ marginTop: '1.25rem' }}>
                                  <div className="section-label">Trades</div>
                                  <table className="agent-subtable">
                                    <thead>
                                      <tr>
                                        <th style={{ textAlign: 'left' }}>When</th>
                                        <th style={{ textAlign: 'left' }}>Market</th>
                                        <th style={{ textAlign: 'left' }}>Target</th>
                                        <th style={{ textAlign: 'left' }}>Side</th>
                                        <th style={{ textAlign: 'right' }}>Shares</th>
                                        <th style={{ textAlign: 'right' }}>Cash</th>
                                        <th style={{ textAlign: 'left' }}>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {trades.map(t => {
                                        const cash = -t.cost;
                                        return (
                                          <tr key={t.id}>
                                            <td className="agent-num" style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>{new Date(t.createdAt).toLocaleString()}</td>
                                            <td>{t.metricName ?? t.marketId}</td>
                                            <td className="agent-num" style={{ textAlign: 'left' }}>{t.targetDate ?? '-'}</td>
                                            <td>
                                              <span className={t.direction === 'higher' ? 'agent-num-pos' : 'agent-num-neg'}>{t.direction}</span>
                                              <span style={{ marginLeft: '0.35rem', color: 'var(--text-secondary)' }}>({t.kind})</span>
                                            </td>
                                            <td className="agent-num">{fmt9(t.shares)}</td>
                                            <td className={`agent-num ${cash >= 0 ? 'agent-num-pos' : 'agent-num-neg'}`}>{signed(cash)}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{t.marketStatus}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
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
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Permission groups</h2>
          <p className="section-subtitle">
            Manage group capabilities and per-metric permissions. Assign participants using the + add control in the table above.
          </p>
        </div>

        <form onSubmit={handleCreateGroup} className="agent-form-inline" style={{ marginBottom: '1.25rem' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {groups.map(group => {
              const isExpanded = expandedGroupId === group.id;
              const systemGroup = isSystemGroup(group.type);
              const restrictedMetrics = Object.keys(group.permissions).length;
              const memberCount = group.memberIds.length;
              const caps = (group.capabilities ?? []).join(', ') || 'no capabilities';
              const metaParts = [caps, memberCount > 0 ? `${memberCount} participant${memberCount !== 1 ? 's' : ''}` : 'empty'];
              if (restrictedMetrics > 0) metaParts.push(`${restrictedMetrics} metric rule${restrictedMetrics !== 1 ? 's' : ''}`);

              return (
                <div key={group.id} className={`group-row${isExpanded ? ' expanded' : ''}`}>
                  <div className="group-row-head" onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}>
                    <div className="group-row-title">
                      <span className="group-row-name">{group.name}</span>
                      <span className="group-row-meta">{metaParts.join(' · ')}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      {!systemGroup && (
                        <button className="btn-small btn-delete" onClick={e => { e.stopPropagation(); handleDeleteGroup(group.id); }}>Delete</button>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{isExpanded ? '▾' : '▸'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="group-row-body">
                      <div className="group-subsection">
                        <div className="section-label">Capabilities</div>
                        <div className="capability-row">
                          {(['read', 'trade', 'manage', 'manage_workspace'] as Capability[]).map(cap => {
                            const checked = (group.capabilities ?? []).includes(cap);
                            return (
                              <label key={cap}>
                                <input type="checkbox" checked={checked} onChange={() => handleToggleCapability(group, cap)} />
                                {cap}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="group-subsection">
                        <div className="section-label">Metric permissions</div>
                        {metrics.length === 0 ? (
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No leaf metrics.</p>
                        ) : (
                          <table className="agent-subtable">
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left' }}>Metric</th>
                                <th style={{ textAlign: 'center', width: 60 }}>Read</th>
                                <th style={{ textAlign: 'center', width: 60 }}>Trade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metrics.map(m => {
                                const perms = group.permissions[m.id] ?? { read: false, trade: false };
                                return (
                                  <tr key={m.id}>
                                    <td>{m.name}</td>
                                    <td style={{ textAlign: 'center' }}>
                                      <input type="checkbox" checked={perms.read} onChange={() => handleTogglePermission(group, m.id, 'read')} />
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      <input type="checkbox" checked={perms.trade} onChange={() => handleTogglePermission(group, m.id, 'trade')} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {sourcesList.length > 0 && (
                        <div className="group-subsection">
                          <div className="section-label">Source permissions</div>
                          <table className="agent-subtable">
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left' }}>Source</th>
                                <th style={{ textAlign: 'left', width: 80 }}>Type</th>
                                <th style={{ textAlign: 'center', width: 60 }}>Read</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sourcesList.map(s => {
                                const hasAccess = group.sourcePermissions?.[s.id]?.read ?? false;
                                return (
                                  <tr key={s.id}>
                                    <td>{s.name}</td>
                                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.type}</td>
                                    <td style={{ textAlign: 'center' }}>
                                      <input type="checkbox" checked={hasAccess} onChange={() => handleToggleSourcePermission(group, s.id)} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
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

// ─── Main export: routes to correct view based on workspace state ────────────

export function ParticipantsPage() {
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
