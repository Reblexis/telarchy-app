import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type AgentHeartbeat, type AgentTrace, type AgentTraceEntry } from '../lib/api';

const OUTCOME_COLORS: Record<string, string> = {
  trade: '#16a34a',
  'skip-under-threshold': '#64748b',
  'trade-too-small': '#ca8a04',
  'trade-error': '#dc2626',
  'unknown-market': '#7c3aed',
};

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
}

export function AgentTelemetryPanel({ workspaceId }: Props) {
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeat[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [hb, tr] = await Promise.all([
        api.getAgentHeartbeats(workspaceId),
        api.getAgentTraces({ agentId: selectedAgent ?? undefined, limit: 30 }, workspaceId),
      ]);
      setHeartbeats(hb.heartbeats);
      setTraces(tr.traces);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedAgent]);

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
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {loading ? 'Refreshing…' : 'Live (5s)'}
        </span>
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

      <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '1.5rem 0 0.5rem' }}>
        Decision traces ({traces.length})
      </h3>
      {traces.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          No decision traces yet. AI strategies (ai-analyst, ai-researcher) push a trace per session; deterministic strategies don't generate them.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '60vh', overflowY: 'auto' }}>
          {traces.map(t => {
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
                            <strong style={{ fontSize: '0.8rem' }}>{e.metric}</strong>
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
    </div>
  );
}
