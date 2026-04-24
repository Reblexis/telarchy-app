import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type AgentHeartbeat, type AgentTrace, type AgentTraceEntry } from '../lib/api';

/** Five canonical outcome strings carry hand-picked colors so the common
 *  values are visually consistent. Outcomes are otherwise derived purely
 *  from observed data — no list is enumerated to gate visibility. Custom
 *  outcomes get a deterministic fallback color. */
const OUTCOME_COLORS: Record<string, string> = {
  trade: '#16a34a',
  'skip-under-threshold': '#64748b',
  'trade-too-small': '#ca8a04',
  'trade-error': '#dc2626',
  'unknown-market': '#7c3aed',
};
/** Stable color hash for unknown outcomes / strategies. Picks one of a small
 *  palette deterministically from the string so chips don't flicker between
 *  refreshes. */
const FALLBACK_PALETTE = ['#0891b2', '#9333ea', '#db2777', '#0e7490', '#65a30d', '#b45309', '#475569'];
function colorFor(name: string, registry: Record<string, string>): string {
  if (registry[name]) return registry[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

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

/** Resolve workspace name for display. Backend joins on the workspaces
 *  table and ships `workspaceName` directly on every heartbeat / trace,
 *  so a missing name is the rare case (workspace deleted, race). */
function workspaceLabel(id: string | null | undefined, name: string | null | undefined): string {
  if (name) return name;
  if (!id) return '—';
  return id.slice(0, 8);
}

export function AgentTelemetryPanel({ workspaceId, isPlatformAdmin }: Props) {
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeat[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState(Date.now());
  // Platform admins default to the cross-workspace view since bots run
  // against many workspaces and the most useful view is "show everything
  // they're doing platform-wide".
  const [scopeAll, setScopeAll] = useState<boolean>(isPlatformAdmin ?? false);
  // Filter sets store EXCLUDED values (default: nothing excluded = all on).
  // Open vocabulary: any new participant / workspace / outcome string in
  // observed data appears as an on-by-default chip without an allowlist.
  const [outcomeExcluded, setOutcomeExcluded] = useState<Set<string>>(new Set());
  const [participantExcluded, setParticipantExcluded] = useState<Set<string>>(new Set());
  const [workspaceExcluded, setWorkspaceExcluded] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(false);
  /** Substring (case-insensitive) matched against entry.metric and entry.marketId.
   *  Empty = no metric filter. Auto-implies hideEmpty so the result list is tight. */
  const [metricFilter, setMetricFilter] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };
  const toggleOutcome = (o: string) => toggle(outcomeExcluded, o, setOutcomeExcluded);
  const toggleParticipant = (p: string) => toggle(participantExcluded, p, setParticipantExcluded);
  const toggleWorkspace = (w: string) => toggle(workspaceExcluded, w, setWorkspaceExcluded);

  const fetchAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const tracesScope = isPlatformAdmin && scopeAll ? 'all' : undefined;
      const [hb, tr] = await Promise.all([
        api.getAgentHeartbeats(workspaceId),
        api.getAgentTraces({ limit: 30, scopeWorkspaceId: tracesScope }, workspaceId),
      ]);
      setHeartbeats(hb.heartbeats);
      setTraces(tr.traces);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isPlatformAdmin, scopeAll]);

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
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Automated participants</h2>
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
          No bot heartbeats received yet. Once <code>telarchy-agents</code> runs against this backend, automated participants appear here.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Participant</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Strategy</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Workspace</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Last cycle</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Next cycle</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Last result</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.map(hb => (
                <tr key={hb.agentId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontWeight: 600 }}>{hb.agentId}</td>
                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{hb.strategy ?? '—'}</td>
                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{workspaceLabel(hb.workspaceId, hb.workspaceName)}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(() => {
        // Chip vocabularies are derived purely from observed data — no
        // canonical list, no allowlist. Any new participant / workspace /
        // outcome string in observed traces or heartbeats gets an
        // on-by-default chip on the next refresh.
        const observedParticipants = new Set<string>();
        // Workspace ids ↔ name resolution shipped on each heartbeat / trace,
        // so we keep a co-derived name map for chip labels.
        const observedWorkspaces = new Map<string, string | null>();
        const observedOutcomes = new Set<string>();
        for (const hb of heartbeats) {
          observedParticipants.add(hb.agentId);
          if (hb.workspaceId) observedWorkspaces.set(hb.workspaceId, hb.workspaceName);
        }
        for (const t of traces) {
          observedParticipants.add(t.agentId);
          observedWorkspaces.set(t.workspaceId, t.workspaceName);
          for (const e of t.entries) observedOutcomes.add(e.outcome);
        }

        const participantChips = Array.from(observedParticipants).sort();
        const workspaceChips = Array.from(observedWorkspaces.entries())
          .sort((a, b) => workspaceLabel(a[0], a[1]).localeCompare(workspaceLabel(b[0], b[1])));
        const outcomeChips = Array.from(observedOutcomes).sort();

        const metricNeedle = metricFilter.trim().toLowerCase();
        const matchesMetric = (e: AgentTraceEntry) =>
          metricNeedle === '' ||
          e.metric.toLowerCase().includes(metricNeedle) ||
          e.marketId.toLowerCase().includes(metricNeedle);
        const dropEmpty = hideEmpty || metricNeedle !== '';
        const filteredTraces = traces
          .filter(t => !participantExcluded.has(t.agentId))
          .filter(t => !workspaceExcluded.has(t.workspaceId))
          .map(t => ({
            ...t,
            entries: t.entries.filter(e => !outcomeExcluded.has(e.outcome) && matchesMetric(e)),
          }))
          .filter(t => !dropEmpty || t.entries.length > 0);
        const totalShown = filteredTraces.length;
        const totalEntries = filteredTraces.reduce((s, t) => s + t.entries.length, 0);

        const chipStyle = (on: boolean, color: string) => ({
          fontSize: '0.65rem',
          padding: '0.15rem 0.5rem',
          border: `1px solid ${on ? color : 'var(--border-color)'}`,
          borderRadius: 'var(--radius-full, 999px)',
          background: on ? color : 'var(--bg-secondary)',
          color: on ? '#fff' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontWeight: on ? 600 : 500,
        }) as const;

        return (
          <>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '1.5rem 0 0.5rem' }}>
              Decision traces ({totalShown}/{traces.length} traces · {totalEntries} entries)
            </h3>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Outcome</span>
              {outcomeChips.length === 0 ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>none yet</span>
              ) : outcomeChips.map(o => {
                const on = !outcomeExcluded.has(o);
                return (
                  <button key={o} onClick={() => toggleOutcome(o)} style={chipStyle(on, colorFor(o, OUTCOME_COLORS))}>
                    {o}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Participant</span>
              {participantChips.length === 0 ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>none yet</span>
              ) : participantChips.map(p => {
                const on = !participantExcluded.has(p);
                return (
                  <button key={p} onClick={() => toggleParticipant(p)} style={{ ...chipStyle(on, colorFor(p, {})), fontFamily: 'monospace' }}>
                    {p}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Workspace</span>
              {workspaceChips.length === 0 ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>none yet</span>
              ) : workspaceChips.map(([id, name]) => {
                const on = !workspaceExcluded.has(id);
                return (
                  <button key={id} onClick={() => toggleWorkspace(id)} style={chipStyle(on, colorFor(id, {}))}>
                    {workspaceLabel(id, name)}
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
            ? 'No decision traces yet. Participants push them per cycle (deterministic) or per session (LLM).'
            : 'No traces match the current outcome / participant / workspace / metric filters.'}
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
                    {new Date(t.startedAt).toLocaleString()} · {t.strategy} · {t.model ?? '—'} · in <strong>{workspaceLabel(t.workspaceId, t.workspaceName)}</strong>
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
                              background: colorFor(e.outcome, OUTCOME_COLORS),
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
