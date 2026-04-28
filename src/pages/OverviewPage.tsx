import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type ActivityItem } from '../lib/api';
import type { Metric, TaskProposal } from '../types';
import { fmtTime } from '../lib/date-utils';
import {
  ACTIVITY_TYPE_COLOR,
  ACTIVITY_TYPE_LABEL,
  summarizeActivity,
} from '../lib/activity-summary';

interface ApiError { message: string }

function isLeafMetric(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '' || m.formula.trim() === '0';
}

function primaryValue(m: Metric): { label: string; value: string } {
  const hasTP = m.timePreference?.enabled === true;
  const leaf = isLeafMetric(m);
  if (leaf && !hasTP) return { label: 'Now', value: m.value.toFixed(2) };
  if (leaf && hasTP) return { label: 'Outlook', value: m.total === null ? '–' : m.total.toFixed(2) };
  if (!leaf && hasTP) return { label: 'Outlook', value: m.total === null ? '–' : m.total.toFixed(2) };
  return { label: 'Now', value: m.total === null ? '–' : m.total.toFixed(2) };
}

function activityLink(item: ActivityItem): string | null {
  if (item.taskId) return `/tasks?id=${encodeURIComponent(item.taskId)}`;
  if (item.marketId) return `/markets?marketId=${encodeURIComponent(item.marketId)}`;
  if (item.metricId) return `/metrics`;
  return null;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtTime(d.getTime() / 1000);
}

export function OverviewPage() {
  const { user } = useAuth();
  const { workspace, allWorkspaces } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';

  const workspaceName = useMemo(() => {
    return allWorkspaces.find(w => w.id === workspace?.workspaceId)?.name ?? '';
  }, [allWorkspaces, workspace?.workspaceId]);

  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [pending, setPending] = useState<TaskProposal[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    if (!user || !workspace?.workspaceId) return;
    let cancelled = false;
    api.getMetrics()
      .then((rows: Metric[]) => { if (!cancelled) { setMetrics(rows); setMetricsError(null); } })
      .catch((e: ApiError) => { if (!cancelled) { setMetricsError(e.message); setMetrics([]); } });
    return () => { cancelled = true; };
  }, [user, workspace?.workspaceId]);

  useEffect(() => {
    if (!user || !isAdmin || !workspace?.workspaceId) { setPending([]); return; }
    let cancelled = false;
    api.getTasks('pending')
      .then((rows: TaskProposal[]) => { if (!cancelled) setPending(rows); })
      .catch((e: ApiError) => {
        console.error('Failed to load pending tasks for overview', e.message);
        if (!cancelled) setPending([]);
      });
    return () => { cancelled = true; };
  }, [user, isAdmin, workspace?.workspaceId]);

  useEffect(() => {
    if (!user || !workspace?.workspaceId) { setActivity([]); return; }
    let cancelled = false;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    api.getActivity({ since, limit: 30 }, workspace.workspaceId)
      .then(data => {
        if (cancelled) return;
        const filtered = data.activities.filter(item => {
          if (item.type !== 'liquidity') return true;
          const amt = Number((item.data as { amount?: unknown }).amount ?? 0);
          return Math.abs(amt) >= 0.01;
        }).slice(0, 8);
        setActivity(filtered);
      })
      .catch((e: ApiError) => {
        console.error('Failed to load activity for overview', e.message);
        if (!cancelled) setActivity([]);
      });
    return () => { cancelled = true; };
  }, [user, workspace?.workspaceId]);

  const topLevelMetrics = useMemo(
    () => (metrics ?? []).filter(m => (m.depth ?? 0) === 0),
    [metrics],
  );

  if (!user || !workspace) return <div className="loading">Loading…</div>;

  if (workspace.tier === 'none') {
    return (
      <div className="container">
        <p style={{ color: 'var(--text-secondary)' }}>You don't have access to this workspace yet.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', letterSpacing: '-0.02em', margin: 0 }}>
          {workspaceName || 'Workspace'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          What's changed and what needs you, at a glance.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: '1.5rem',
        alignItems: 'start',
      }} className="overview-grid">
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Health snapshot</h2>
            <Link to="/metrics" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              All metrics →
            </Link>
          </div>
          {metricsError && (
            <div className="error show" style={{ marginBottom: '0.75rem' }}>{metricsError}</div>
          )}
          {!metrics ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>Loading metrics…</div>
          ) : topLevelMetrics.length === 0 ? (
            <div style={{
              border: '1px dashed var(--border-color)', borderRadius: '0.5rem',
              padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.9rem',
            }}>
              No top-level metrics yet.{' '}
              {isAdmin && <Link to="/metrics">Add one →</Link>}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.75rem',
            }}>
              {topLevelMetrics.map(m => {
                const primary = primaryValue(m);
                const hasDelta = !isLeafMetric(m) && m.baselineTotal != null && m.total !== null;
                const delta = hasDelta ? (m.total as number) - (m.baselineTotal as number) : 0;
                const showDelta = hasDelta && Math.abs(delta) >= 0.005;
                return (
                  <Link
                    key={m.id}
                    to="/metrics"
                    style={{
                      display: 'flex', flexDirection: 'column', gap: '0.4rem',
                      padding: '0.9rem 1rem',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      textDecoration: 'none', color: 'var(--text-primary)',
                      transition: 'border-color 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--focus-border)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.4rem', fontWeight: 600 }}>
                        {primary.value}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {primary.label.toLowerCase()}
                      </span>
                    </div>
                    {showDelta && (
                      <div style={{
                        fontSize: '0.8rem',
                        color: delta > 0 ? 'var(--success-text, #22c55e)' : 'var(--error-text, #ef4444)',
                        fontWeight: 500,
                      }}>
                        {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: '0.35rem' }}>
                          vs baseline
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {isAdmin && (
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              background: 'var(--bg-secondary)', padding: '1rem 1.1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Awaiting your decision</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  {pending == null ? '…' : `${pending.length} pending`}
                </span>
              </div>
              {pending == null ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Loading…</div>
              ) : pending.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                  Nothing to approve right now.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {pending.slice(0, 5).map(t => (
                      <Link
                        key={t.id}
                        to={`/tasks?id=${t.id}`}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.5rem 0.65rem',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          textDecoration: 'none', color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '0.5rem' }}>
                          {t.title}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                          {t.price.toFixed(2)} cr
                        </span>
                      </Link>
                    ))}
                  </div>
                  {pending.length > 5 && (
                    <Link to="/tasks" style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                      View all {pending.length} →
                    </Link>
                  )}
                </>
              )}
            </div>
          )}

          <div style={{
            border: '1px solid var(--border-color)', borderRadius: '0.75rem',
            background: 'var(--bg-secondary)', padding: '1rem 1.1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>Recent activity</strong>
              <Link to="/activity" style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                Full feed →
              </Link>
            </div>
            {activity == null ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                Quiet week. Nothing has happened in the last 7 days.
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--border-color)' }}>
                {activity.map(item => {
                  const summary = summarizeActivity(item);
                  if (!summary) return null;
                  const color = ACTIVITY_TYPE_COLOR[item.type] ?? 'var(--text-tertiary)';
                  const label = ACTIVITY_TYPE_LABEL[item.type] ?? item.type;
                  const link = activityLink(item);
                  const row = (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '4px 70px 1fr',
                      gap: '0.55rem',
                      alignItems: 'baseline',
                      padding: '0.5rem 0.1rem',
                      borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.83rem',
                    }}>
                      <div style={{ background: color, alignSelf: 'stretch', borderRadius: 2 }} />
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 600,
                        color, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {label}
                      </span>
                      <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        {summary}
                        <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
                          {timeAgo(item.timestamp)}
                        </span>
                      </span>
                    </div>
                  );
                  return link ? (
                    <Link key={item.id} to={link} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                      {row}
                    </Link>
                  ) : (
                    <div key={item.id}>{row}</div>
                  );
                })}
              </div>
            )}
          </div>

          {!isAdmin && (
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '0.75rem',
              background: 'var(--bg-secondary)', padding: '1rem 1.1rem',
              fontSize: '0.85rem', color: 'var(--text-secondary)',
            }}>
              <strong style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Forecast on this workspace
              </strong>
              Pricing tasks against these metrics is how you contribute.{' '}
              <Link to="/markets">Open markets →</Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
