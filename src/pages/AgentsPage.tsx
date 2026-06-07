import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type AgentHeartbeat, type AgentControl } from '../lib/api';
import { Header } from '../components/Header';

const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  running: '#2563eb',
  error: '#dc2626',
};

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
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
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  return `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

/** True when the UI requested a cycle the runner hasn't fired yet. */
export function triggerPending(c: AgentControl | undefined): boolean {
  if (!c?.triggerRequestedAt) return false;
  if (!c.triggerAckedAt) return true;
  return new Date(c.triggerRequestedAt).getTime() > new Date(c.triggerAckedAt).getTime();
}

/** A heartbeat is stale when the runner missed its own next-cycle estimate by
 *  a wide margin (or never reported). Cadences are hours here, so the margin
 *  is generous: 15 minutes past nextCycleAt, or 7h without any update.
 *  A running cycle legitimately outlasts its own (already due) next-cycle
 *  estimate, so a fresh `running` heartbeat is never stale. */
export function isStale(hb: AgentHeartbeat | undefined): boolean {
  if (!hb) return true;
  if (hb.status === 'running' && Date.now() - new Date(hb.updatedAt).getTime() < 30 * 60 * 1000) return false;
  if (hb.nextCycleAt) return Date.now() - new Date(hb.nextCycleAt).getTime() > 15 * 60 * 1000;
  return Date.now() - new Date(hb.updatedAt).getTime() > 7 * 60 * 60 * 1000;
}

interface AgentRow {
  agentId: string;
  heartbeat?: AgentHeartbeat;
  control?: AgentControl;
}

export function AgentsPage() {
  const { user } = useAuth();
  const { workspace, loading: wsLoading } = useWorkspace(Boolean(user));
  const isPlatformAdmin = workspace?.platformAdmin === true;

  const [rows, setRows] = useState<AgentRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [hb, ctl] = await Promise.all([
        api.getAgentHeartbeats(workspace?.workspaceId),
        api.getAgentControls(),
      ]);
      const byId = new Map<string, AgentRow>();
      for (const h of hb.heartbeats) byId.set(h.agentId, { agentId: h.agentId, heartbeat: h });
      for (const c of ctl.controls) {
        const row = byId.get(c.agentId) ?? { agentId: c.agentId };
        row.control = c;
        byId.set(c.agentId, row);
      }
      setRows(Array.from(byId.values()).sort((a, b) => a.agentId.localeCompare(b.agentId)));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspace?.workspaceId]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await fetchAll();
      if (cancelled) return;
      pollRef.current = setTimeout(loop, 5000);
    };
    loop();
    return () => {
      cancelled = true;
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    };
  }, [isPlatformAdmin, fetchAll]);

  // Tick so "Xs ago" labels stay fresh between polls.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const setControl = async (agentId: string, params: { desiredState?: 'enabled' | 'paused'; trigger?: boolean }) => {
    setBusy(agentId);
    try {
      await api.setAgentControl({ agentId, ...params });
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!user || wsLoading) return <div className="loading">Loading…</div>;

  if (!isPlatformAdmin) {
    return (
      <>
        <Header navMode="platform" />
        <div className="container">
          <h1 style={{ marginBottom: '1rem', fontSize: '1.3rem', fontWeight: 700 }}>Agents</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Platform admin access required.
          </div>
        </div>
      </>
    );
  }

  const btnStyle = {
    fontSize: '0.7rem',
    padding: '0.25rem 0.55rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
  } as const;

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Agents</h1>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Live (5s)</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1.5rem' }}>
          Out-of-process agent runners. Pause stops cycle bodies (heartbeats continue);
          Run now requests an immediate cycle on the runner's next tick.
        </p>

        {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

        {rows.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            No agents have reported yet. Runners appear here once they push a heartbeat
            (POST /api/admin/agent-heartbeat) or receive a control row.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Agent</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Strategy</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Last cycle</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Next cycle</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Last result</th>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Balance</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Controls</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ agentId, heartbeat: hb, control }) => {
                  const paused = control?.desiredState === 'paused';
                  const stale = !paused && isStale(hb);
                  const pending = triggerPending(control);
                  return (
                    <tr key={agentId} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontWeight: 600 }}>
                        <Link to={`/agents/${encodeURIComponent(agentId)}`} style={{ color: 'var(--text-primary)' }}>
                          {agentId}
                        </Link>
                        {hb?.lastError && (
                          <span title={hb.lastError} style={{ marginLeft: '0.4rem', color: '#dc2626', cursor: 'help' }}>⚠</span>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.1rem 0.4rem',
                          borderRadius: 'var(--radius-md)',
                          background: paused ? '#ca8a04' : stale ? '#7c3aed' : (STATUS_COLORS[hb?.status ?? ''] ?? 'var(--bg-tertiary)'),
                          color: '#fff',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                        }}>
                          {paused ? 'paused' : stale ? (hb ? 'stale' : 'no heartbeat') : hb?.status}
                        </span>
                        {pending && (
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                            trigger pending
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{hb?.strategy ?? '—'}</td>
                      <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{fmtAgo(hb?.lastCycleEndedAt ?? null)}</td>
                      <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{paused ? '—' : fmtIn(hb?.nextCycleAt ?? null)}</td>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {hb ? (
                          <>
                            <span style={{ color: '#16a34a' }}>{hb.lastTraded}t</span>
                            {' '}
                            <span style={{ color: '#64748b' }}>{hb.lastSkipped}s</span>
                            {hb.lastErrors > 0 && <> <span style={{ color: '#dc2626' }}>{hb.lastErrors}e</span></>}
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>
                        {hb?.balance != null ? `${hb.balance.toFixed(2)} cr` : '—'}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          style={btnStyle}
                          disabled={busy === agentId}
                          onClick={() => setControl(agentId, { desiredState: paused ? 'enabled' : 'paused' })}
                        >
                          {paused ? 'Resume' : 'Pause'}
                        </button>
                        {' '}
                        <button
                          style={{ ...btnStyle, opacity: pending || paused ? 0.5 : 1 }}
                          disabled={busy === agentId || pending || paused}
                          title={paused ? 'Resume first' : pending ? 'Already requested' : 'Fire a cycle on the next runner tick'}
                          onClick={() => setControl(agentId, { trigger: true })}
                        >
                          Run now
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
