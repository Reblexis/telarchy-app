import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type ActivityItem } from '../lib/api';
import { Header } from '../components/Header';
import { AgentTelemetryPanel } from '../components/AgentTelemetryPanel';
import { FeedbackInbox } from '../components/FeedbackInbox';

const ACTIVITY_TYPES = [
  'trade', 'deposit', 'withdrawal', 'market_created', 'market_resolved',
  'metric_update', 'task_created', 'task_message', 'liquidity',
] as const;

const TYPE_COLORS: Record<string, string> = {
  trade: '#2563eb',
  deposit: '#16a34a',
  withdrawal: '#ca8a04',
  market_created: '#7c3aed',
  market_resolved: '#9333ea',
  metric_update: '#0891b2',
  task_created: '#db2777',
  task_message: '#be185d',
  liquidity: '#65a30d',
};

const TIME_RANGES: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

function summarize(item: ActivityItem): string {
  const d = item.data as Record<string, unknown>;
  switch (item.type) {
    case 'trade':
      return `${d.direction} ${Number(d.shares ?? 0).toFixed(2)} shares for ${Number(d.cost ?? 0).toFixed(2)} cr`;
    case 'deposit':
      return `+${Number(d.credits ?? 0).toFixed(2)} cr (${d.usdcAmount} USDC)`;
    case 'withdrawal':
      return `-${Number(d.credits ?? 0).toFixed(2)} cr → ${d.toAddress ?? ''}`;
    case 'market_created':
      return `${d.metricName ?? 'market'} @ ${d.targetDate ?? ''}`;
    case 'market_resolved':
      return `${d.metricName ?? 'market'} resolved${d.voided ? ' (voided)' : ''} actual=${d.actualValue ?? '?'}`;
    case 'metric_update':
      return `${d.metricName ?? 'metric'}: ${d.oldValue ?? '?'} → ${d.newValue ?? '?'}`;
    case 'task_created':
      return `${d.title ?? 'task'} (${d.status ?? 'open'}) ${d.price ?? 0} cr`;
    case 'task_message':
      return typeof d.content === 'string' ? (d.content.length > 120 ? d.content.slice(0, 120) + '…' : d.content) : '';
    case 'liquidity': {
      const amt = Number(d.amount ?? 0);
      return `${d.kind ?? 'liquidity'} ${amt >= 0 ? '+' : ''}${amt.toFixed(2)} (pool=${Number(d.totalLiquidity ?? 0).toFixed(2)})`;
    }
    default:
      return JSON.stringify(d);
  }
}

export function AdminPage() {
  const { user } = useAuth();
  const { workspace, allWorkspaces, loading: wsLoading } = useWorkspace(Boolean(user));

  const isPlatformAdmin = workspace?.platformAdmin === true;

  // Activity feed has only ever been workspace-scoped (per the existing
  // /api/admin/activity behaviour). Platform admins can browse any workspace
  // they're a member of even if they aren't admin there; non-platform admins
  // see only the workspaces where they are owner/admin.
  const adminWorkspaces = useMemo(
    () => isPlatformAdmin
      ? allWorkspaces
      : allWorkspaces.filter(w => w.memberRole === 'owner' || w.memberRole === 'admin'),
    [allWorkspaces, isPlatformAdmin],
  );

  const [usdcEnabled, setUsdcEnabled] = useState<boolean | null>(null);
  const [treasury, setTreasury] = useState<{ address: string; usdcBalance: number; ethBalance: number } | null>(null);
  const [treasuryError, setTreasuryError] = useState('');

  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(ACTIVITY_TYPES));
  const [participantId, setParticipantId] = useState('');
  const [marketId, setMarketId] = useState('');
  const [metricId, setMetricId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [paused, setPaused] = useState(false);

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [feedError, setFeedError] = useState('');
  const [feedLoading, setFeedLoading] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    api.getStatus()
      .then(s => {
        const enabled = Boolean((s as { usdcSettlementEnabled?: boolean }).usdcSettlementEnabled);
        setUsdcEnabled(enabled);
        if (enabled) {
          api.getTreasury()
            .then(data => setTreasury(data as { address: string; usdcBalance: number; ethBalance: number }))
            .catch((e: Error) => setTreasuryError(e.message));
        }
      })
      .catch(() => setUsdcEnabled(false));
  }, [user]);

  useEffect(() => {
    if (!selectedWorkspace && adminWorkspaces.length > 0) {
      setSelectedWorkspace(adminWorkspaces[0].id);
    }
  }, [adminWorkspaces, selectedWorkspace]);

  const fetchActivity = useCallback(async () => {
    if (!selectedWorkspace) return;
    setFeedLoading(true);
    try {
      const since = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const data = await api.getAdminActivity({
        since,
        limit: 200,
        types: selectedTypes.size === ACTIVITY_TYPES.length ? undefined : Array.from(selectedTypes),
        participantId: participantId.trim() || undefined,
        marketId: marketId.trim() || undefined,
        metricId: metricId.trim() || undefined,
        taskId: taskId.trim() || undefined,
      }, selectedWorkspace);
      setActivities(data.activities);
      setFeedError('');
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedLoading(false);
    }
  }, [selectedWorkspace, rangeHours, selectedTypes, participantId, marketId, metricId, taskId]);

  useEffect(() => {
    if (!selectedWorkspace || paused) {
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchActivity();
      if (cancelled) return;
      pollTimer.current = setTimeout(tick, 4000);
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
    };
  }, [fetchActivity, selectedWorkspace, paused]);

  const toggleType = (t: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  if (!user || usdcEnabled === null || wsLoading) return <div className="loading">Loading…</div>;

  return (
    <>
      <Header navMode="platform" />
      <div className="container">
        <h1 style={{ marginBottom: '1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>Platform Admin</h1>

        {treasuryError && (
          <div className="error show" style={{ marginBottom: '1rem' }}>{treasuryError}</div>
        )}

        {treasury && (
          <div className="section" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Treasury (Base)</h2>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>USDC</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>${treasury.usdcBalance.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>ETH</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem' }}>{treasury.ethBalance.toFixed(6)} ETH</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Address</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{treasury.address}</div>
              </div>
            </div>
          </div>
        )}

        {selectedWorkspace && (
          <AgentTelemetryPanel
            workspaceId={selectedWorkspace}
            isPlatformAdmin={isPlatformAdmin}
          />
        )}

        {isPlatformAdmin && <FeedbackInbox />}

        <div className="section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Activity feed</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {feedLoading ? 'Refreshing…' : paused ? 'Paused' : 'Live (4s)'}
              </span>
              <button
                onClick={() => setPaused(p => !p)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={() => { fetchActivity(); }}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
              >
                Refresh
              </button>
            </div>
          </div>

          {adminWorkspaces.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              You are not an owner/admin in any workspace, so there is no activity feed available.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Workspace</label>
                  <select
                    value={selectedWorkspace}
                    onChange={e => setSelectedWorkspace(e.target.value)}
                    style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.85rem' }}
                  >
                    {adminWorkspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>Range</label>
                  <select
                    value={rangeHours}
                    onChange={e => setRangeHours(Number(e.target.value))}
                    style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.85rem' }}
                  >
                    {TIME_RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {ACTIVITY_TYPES.map(t => {
                    const on = selectedTypes.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleType(t)}
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.25rem 0.55rem',
                          border: `1px solid ${on ? TYPE_COLORS[t] : 'var(--border-color)'}`,
                          borderRadius: 'var(--radius-full, 999px)',
                          background: on ? TYPE_COLORS[t] : 'var(--bg-secondary)',
                          color: on ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: on ? 600 : 500,
                        }}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    placeholder="participantId"
                    value={participantId}
                    onChange={e => setParticipantId(e.target.value)}
                    style={{ flex: '1 1 180px', padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  />
                  <input
                    placeholder="marketId"
                    value={marketId}
                    onChange={e => setMarketId(e.target.value)}
                    style={{ flex: '1 1 140px', padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  />
                  <input
                    placeholder="metricId"
                    value={metricId}
                    onChange={e => setMetricId(e.target.value)}
                    style={{ flex: '1 1 140px', padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  />
                  <input
                    placeholder="taskId"
                    value={taskId}
                    onChange={e => setTaskId(e.target.value)}
                    style={{ flex: '1 1 140px', padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {feedError && <div className="error show" style={{ marginBottom: '1rem' }}>{feedError}</div>}

              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '60vh', overflowY: 'auto' }}>
                {activities.length === 0 && !feedLoading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    No activity in the selected range.
                  </div>
                ) : (
                  activities.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 130px 1fr 1fr',
                        gap: '0.75rem',
                        alignItems: 'start',
                        padding: '0.55rem 0.75rem',
                        borderBottom: '1px solid var(--border-color)',
                        fontSize: '0.8rem',
                      }}
                    >
                      <span style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.45rem',
                        borderRadius: 'var(--radius-md)',
                        background: TYPE_COLORS[item.type] ?? 'var(--bg-tertiary)',
                        color: '#fff',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.type}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {item.actor?.label ?? '—'}
                      </span>
                      <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        {summarize(item)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
