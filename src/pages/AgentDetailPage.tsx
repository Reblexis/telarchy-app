import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type AgentHeartbeat, type AgentControl } from '../lib/api';
import { Header } from '../components/Header';
import { AgentTelemetryPanel } from '../components/AgentTelemetryPanel';
import { triggerPending, isStale } from './AgentsPage';

const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  running: '#2563eb',
  error: '#dc2626',
};

function fmtTs(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function AgentDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { workspace, loading: wsLoading } = useWorkspace(Boolean(user));
  const isPlatformAdmin = workspace?.platformAdmin === true;

  const [heartbeat, setHeartbeat] = useState<AgentHeartbeat | undefined>();
  const [control, setControl] = useState<AgentControl | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [hb, ctl] = await Promise.all([
        api.getAgentHeartbeats(workspace?.workspaceId),
        api.getAgentControls(),
      ]);
      setHeartbeat(hb.heartbeats.find(h => h.agentId === id));
      setControl(ctl.controls.find(c => c.agentId === id));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspace?.workspaceId, id]);

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

  const update = async (params: { desiredState?: 'enabled' | 'paused'; trigger?: boolean }) => {
    setBusy(true);
    try {
      await api.setAgentControl({ agentId: id, ...params });
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!user || wsLoading) return <div className="loading">Loading…</div>;

  if (!isPlatformAdmin) {
    return (
      <>
        <Header navMode="platform" />
        <div className="container">
          <h1 style={{ marginBottom: '1rem', fontSize: '1.3rem', fontWeight: 700 }}>Agent</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Platform admin access required.
          </div>
        </div>
      </>
    );
  }

  const paused = control?.desiredState === 'paused';
  const stale = !paused && isStale(heartbeat);
  const pending = triggerPending(control);

  const btnStyle = {
    fontSize: '0.75rem',
    padding: '0.35rem 0.7rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
  } as const;

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{value}</div>
    </div>
  );

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
          <Link to="/agents" style={{ color: 'var(--text-secondary)' }}>← All agents</Link>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {id}
            <span style={{
              display: 'inline-block',
              marginLeft: '0.6rem',
              padding: '0.15rem 0.5rem',
              borderRadius: 'var(--radius-md)',
              background: paused ? '#ca8a04' : stale ? '#7c3aed' : (STATUS_COLORS[heartbeat?.status ?? ''] ?? 'var(--bg-tertiary)'),
              color: '#fff',
              fontSize: '0.7rem',
              fontWeight: 600,
              verticalAlign: 'middle',
            }}>
              {paused ? 'paused' : stale ? (heartbeat ? 'stale' : 'no heartbeat') : heartbeat?.status}
            </span>
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {pending && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>trigger pending</span>}
            <button style={btnStyle} disabled={busy} onClick={() => update({ desiredState: paused ? 'enabled' : 'paused' })}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              style={{ ...btnStyle, opacity: pending || paused ? 0.5 : 1 }}
              disabled={busy || pending || paused}
              title={paused ? 'Resume first' : pending ? 'Already requested' : 'Fire a cycle on the next runner tick'}
              onClick={() => update({ trigger: true })}
            >
              Run now
            </button>
          </div>
        </div>

        {error && <div className="error show" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div className="section" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
            {field('Strategy', heartbeat?.strategy ?? '—')}
            {field('Last cycle started', fmtTs(heartbeat?.lastCycleStartedAt))}
            {field('Last cycle ended', fmtTs(heartbeat?.lastCycleEndedAt))}
            {field('Next cycle', paused ? 'paused' : fmtTs(heartbeat?.nextCycleAt))}
            {field('Last result', heartbeat
              ? `${heartbeat.lastTraded}t / ${heartbeat.lastSkipped}s / ${heartbeat.lastErrors}e`
              : '—')}
            {field('Balance', heartbeat?.balance != null ? `${heartbeat.balance.toFixed(2)} cr` : '—')}
            {field('Heartbeat updated', fmtTs(heartbeat?.updatedAt))}
            {field('Control updated', fmtTs(control?.updatedAt))}
          </div>
          {heartbeat?.lastError && (
            <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: '#dc2626', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              lastError: {heartbeat.lastError}
            </div>
          )}
        </div>

        <AgentTelemetryPanel
          workspaceId={workspace?.workspaceId ?? ''}
          isPlatformAdmin={isPlatformAdmin}
          agentId={id}
        />
      </div>
    </>
  );
}
