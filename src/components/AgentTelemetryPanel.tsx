import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type AgentHeartbeat, type AgentTrace, type AgentTraceEntry } from '../lib/api';

const OUTCOME_COLORS: Record<string, string> = {
  trade: '#16a34a',
  'skip-under-threshold': '#64748b',
  'trade-too-small': '#ca8a04',
  'trade-error': '#dc2626',
  'unknown-market': '#7c3aed',
};

const ALL_OUTCOMES = ['trade', 'trade-error', 'trade-too-small', 'skip-under-threshold', 'unknown-market'] as const;
const ALL_STRATEGIES = ['anchor', 'momentum', 'stabilizer', 'blended', 'ai-analyst', 'ai-researcher'] as const;

const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  running: '#2563eb',
  error: '#dc2626',
};

function fmtAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'soon';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtIn(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'overdue';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

interface Props {
  workspaceId: string;
  isPlatformAdmin?: boolean;
}

export function AgentTelemetryPanel({ workspaceId, isPlatformAdmin }: Props) {
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeat[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState(Date.now());
  // Platform admins default to the cross-workspace view since bots run
  // against many workspaces and the most useful view is "show everything
  // they're doing platform-wide".
  const [scopeAll, setScopeAll] = useState<boolean>(isPlatformAdmin ?? false);
  // Outcome and strategy filters operate on the trace list client-side; the
  // server already caps to 30 per response and filtering happens after that.
  const [outcomeFilter, setOutcomeFilter] = useState<Set<string>>(new Set(ALL_OUTCOMES));
  const [strategyFilter, setStrategyFilter] = useState<Set<string>>(new Set(ALL_STRATEGIES));
  const [hideEmpty, setHideEmpty] = useState(false);
  /** Substring (case-insensitive) matched against entry.metric and entry.marketId.
   *  Empty = no metric filter. Auto-implies hideEmpty so the result list is tight. */
  const [metricFilter, setMetricFilter] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleOutcome = (o: string) => setOutcomeFilter(prev => {
    const next = new Set(prev);
    if (next.has(o)) next.delete(o); else next.add(o);
    return next;
  });
  const toggleStrategy = (s: string) => setStrategyFilter(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const fetchAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const tracesScope = isPlatformAdmin && scopeAll ? 'all' : undefined;
      const [hb, tr] = await Promise.all([
        api.getAgentHeartbeats(workspaceId),
        api.getAgentTraces(
          { agentId: selectedAgent ?? undefined, limit: 30, scopeWorkspaceId: tracesScope },
          workspaceId,
        ),
      ]);
      setHeartbeats(hb.heartbeats);
      setTraces(tr.traces);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedAgent, isPlatformAdmin, scopeAll]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchAll();
      if (cancelled) return;
      pollRef.current = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      cancelled = true;
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    };
  }, [fetchAll]);

  // Re-render every second so the countdown ticks.
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  void tickNow;

  return (
    <div className="section" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Bot agents</h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {isPlatformAdmin && (
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={scopeAll}
                onChange={e => setScopeAll(e.target.checked)}
                style={{ margin: 0 }}
              />
              All workspaces
            </label>
          )}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {loading ? 'Refreshing…' : 'Live (5s)'}
          </span>
        </div>
      </div>

      {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

      {heartbeats.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>
          No bot heartbeats received yet. Once <code>telarchy-agents</code> runs against this backend, agents appear here.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Agent</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Strategy</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Last cycle</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Next cycle</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Last result</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.map(hb => {
                const isSelected = selectedAgent === hb.agentId;
                return (
                  <tr
                    key={hb.agentId}
                    onClick={() => setSelectedAgent(isSelected ? null : hb.agentId)}
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontWeight: 600 }}>{hb.agentId}</td>
                    <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{hb.strategy ?? '—'}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--radius-md)',
                        background: STATUS_COLORS[hb.status] ?? 'var(--bg-tertiary)',
                        color: '#fff',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                      }}>
                        {hb.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{fmtAgo(hb.lastCycleEndedAt)}</td>
                    <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{fmtIn(hb.nextCycleAt)}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <span style={{ color: '#16a34a' }}>{hb.lastTraded}t</span>
                      {' '}
                      <span style={{ color: '#64748b' }}>{hb.lastSkipped}s</span>
                      {hb.lastErrors > 0 && <> <span style={{ color: '#dc2626' }}>{hb.lastErrors}e</span></>}
                    </td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>
                      {hb.balance !== null ? `${fmtNum(hb.balance, 2)} cr` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedAgent && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Filtering traces to <code>{selectedAgent}</code>. <button onClick={() => setSelectedAgent(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-color, #2563eb)', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}>clear</button>
        </div>
      )}

      {(() => {
        const metricNeedle = metricFilter.trim().toLowerCase();
        const matchesMetric = (e: AgentTraceEntry) =>
          metricNeedle === '' ||
          e.metric.toLowerCase().includes(metricNeedle) ||
          e.marketId.toLowerCase().includes(metricNeedle);
        const dropEmpty = hideEmpty || metricNeedle !== '';
        const filteredTraces = traces
          .filter(t => strategyFilter.has(t.strategy))
          .map(t => ({
            ...t,
            entries: t.entries.filter(e => outcomeFilter.has(e.outcome) && matchesMetric(e)),
          }))
          .filter(t => !dropEmpty || t.entries.length > 0);
        const totalShown = filteredTraces.length;
        const totalEntries = filteredTraces.reduce((s, t) => s + t.entries.length, 0);
        return (
          <>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '1.5rem 0 0.5rem' }}>
              Decision traces ({totalShown}/{traces.length} traces · {totalEntries} entries)
            </h3>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Outcome</span>
              {ALL_OUTCOMES.map(o => {
                const on = outcomeFilter.has(o);
                return (
                  <button
                    key={o}
                    onClick={() => toggleOutcome(o)}
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.5rem',
                      border: `1px solid ${on ? OUTCOME_COLORS[o] : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-full, 999px)',
                      background: on ? OUTCOME_COLORS[o] : 'var(--bg-secondary)',
                      color: on ? '#fff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: on ? 600 : 500,
                    }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Strategy</span>
              {ALL_STRATEGIES.map(s => {
                const on = strategyFilter.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleStrategy(s)}
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.5rem',
                      border: `1px solid ${on ? '#2563eb' : 'var(--border-color)'}`,
                      borderRadius: 'var(--radius-full, 999px)',
                      background: on ? '#2563eb' : 'var(--bg-secondary)',
                      color: on ? '#fff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: on ? 600 : 500,
                    }}
                  >
                    {s}
                  </button>
                );
              })}
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={e => setHideEmpty(e.target.checked)}
                  style={{ margin: 0 }}
                />
                Hide traces with no matching entries
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Metric / market</span>
              <input
                type="text"
                value={metricFilter}
                onChange={e => setMetricFilter(e.target.value)}
                placeholder="filter by metric name or market id"
                style={{
                  flex: '1 1 280px',
                  maxWidth: '420px',
                  fontSize: '0.75rem',
                  padding: '0.3rem 0.55rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                  fontFamily: 'monospace',
                }}
              />
              {metricFilter && (
                <button
                  onClick={() => setMetricFilter('')}
                  style={{
                    fontSize: '0.7rem',
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-color, #2563eb)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  clear
                </button>
              )}
            </div>

      {totalShown === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {traces.length === 0
            ? 'No decision traces yet. Deterministic strategies push every cycle; AI strategies push per session.'
            : 'No traces match the current outcome / strategy filters.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '60vh', overflowY: 'auto' }}>
          {filteredTraces.map(t => {
            const open = expandedTrace === t.id;
            return (
              <div key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div
                  onClick={() => setExpandedTrace(open ? null : t.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr 200px 110px',
                    gap: '0.75rem',
                    alignItems: 'center',
                    padding: '0.55rem 0.75rem',
                    cursor: 'pointer',
                    background: open ? 'var(--bg-tertiary)' : 'transparent',
                    fontSize: '0.8rem',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.agentId}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {new Date(t.startedAt).toLocaleString()} · {t.strategy} · {t.model ?? '—'}
                    {scopeAll && (
                      <> · <code style={{ fontSize: '0.7rem' }}>{t.workspaceId.slice(0, 8)}</code></>
                    )}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    <span style={{ color: '#16a34a' }}>{t.traded}t</span>
                    {' '}
                    <span style={{ color: '#64748b' }}>{t.skipped}s</span>
                    {t.errors > 0 && <> <span style={{ color: '#dc2626' }}>{t.errors}e</span></>}
                    {' '}/ {t.candidates} cand
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', textAlign: 'right' }}>
                    ${fmtNum(t.costUsd, 4)}
                  </span>
                </div>
                {open && (
                  <div style={{ padding: '0.5rem 1rem 1rem 1rem', background: 'var(--bg-tertiary)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      tokens: {t.tokensIn} in ({t.cacheRead} cached) / {t.tokensOut} out · entries: {t.entries.length}
                    </div>
                    {t.entries.length === 0 ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>No per-market entries.</div>
                    ) : (
                      t.entries.map((e: AgentTraceEntry, i: number) => (
                        <div key={i} style={{ borderTop: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '0.1rem 0.4rem',
                              borderRadius: 'var(--radius-md)',
                              background: OUTCOME_COLORS[e.outcome] ?? 'var(--bg-tertiary)',
                              color: '#fff',
                              fontSize: '0.65rem',
                              fontWeight: 600,
                            }}>
                              {e.outcome}
                            </span>
                            <button
                              onClick={ev => {
                                ev.stopPropagation();
                                setMetricFilter(e.metric);
                              }}
                              title="Filter all traces to this metric"
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                color: 'var(--text-primary)',
                                textDecorationStyle: 'dotted',
                                textDecorationLine: 'underline',
                                textUnderlineOffset: '2px',
                              }}
                            >
                              {e.metric}
                            </button>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>@ {e.targetDate}</span>
                          </div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                            consensus {fmtNum(e.consensus, 0)} → estimate {fmtNum(e.estimate, 0)}
                            {' · '}conf {fmtNum(e.confidence)} · dist {fmtNum(e.distance, 0)} vs thresh {fmtNum(e.threshold, 0)}
                            {e.cost !== undefined && <> · cost {fmtNum(e.cost, 4)} cr</>}
                            {e.resultingConsensus !== undefined && <> · post {fmtNum(e.resultingConsensus, 0)}</>}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontStyle: 'italic', borderLeft: '2px solid var(--border-color)', paddingLeft: '0.5rem' }}>
                            {e.reasoning}
                          </div>
                          {e.error && <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.25rem' }}>error: {e.error}</div>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
          </>
        );
      })()}
    </div>
  );
}
