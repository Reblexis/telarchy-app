import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type ActivityItem } from '../lib/api';
import type { Metric, Proposal } from '../types';
import { fmtTime } from '../lib/date-utils';
import { activityDetail, activityHref, summarizeActivity } from '../lib/activity-summary';

interface ApiError { message: string }

function isLeafMetric(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '' || m.formula.trim() === '0';
}

function primaryValue(m: Metric): {
  label: string;
  value: string;
  nowValue?: string;
  outlookDelta?: number;
} {
  const hasTP = m.timePreference?.enabled === true;
  const leaf = isLeafMetric(m);
  // Only leaves expose a meaningful "now" value: m.value is the user-set
  // current state, m.total is the time-decayed projection. Derived metrics
  // with TP are inherently an outlook concept (the formula evaluated at
  // future dates), so we skip the "now" column for them.
  if (leaf && hasTP) {
    const outlookDelta = m.total === null ? undefined : m.total - m.value;
    return {
      label: 'outlook',
      value: m.total === null ? '–' : m.total.toFixed(2),
      nowValue: m.value.toFixed(2),
      outlookDelta,
    };
  }
  if (leaf) return { label: 'now', value: m.value.toFixed(2) };
  if (hasTP) return { label: 'outlook', value: m.total === null ? '–' : m.total.toFixed(2) };
  return { label: 'now', value: m.total === null ? '–' : m.total.toFixed(2) };
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d`;
  return fmtTime(d.getTime() / 1000);
}

export function OverviewPage() {
  const { user } = useAuth();
  const { workspace, allWorkspaces } = useWorkspace(!!user);
  const isAdmin = workspace?.tier === 'admin';

  const workspaceName = useMemo(
    () => allWorkspaces.find(w => w.id === workspace?.workspaceId)?.name ?? '',
    [allWorkspaces, workspace?.workspaceId],
  );

  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [pending, setPending] = useState<Proposal[] | null>(null);
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
    api.getProposals('pending')
      .then((rows: Proposal[]) => { if (!cancelled) setPending(rows); })
      .catch((e: ApiError) => {
        console.error('Failed to load pending proposals for overview', e.message);
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
        }).slice(0, 6);
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
      <div className="overview">
        <p className="overview-muted">You don't have access to this workspace yet.</p>
      </div>
    );
  }

  return (
    <div className="overview">
      <h1 className="overview-title">{workspaceName || 'Workspace'}</h1>

      {metricsError ? (
        <div className="error show">{metricsError}</div>
      ) : !metrics ? null : topLevelMetrics.length === 0 ? (
        <p className="overview-muted">
          No top-level metrics yet.{' '}
          {isAdmin && <Link to="/metrics">Add one →</Link>}
        </p>
      ) : (
        <section className="overview-kpis">
          {topLevelMetrics.map(m => {
            const primary = primaryValue(m);
            const hasBaselineDelta = !isLeafMetric(m) && m.baselineTotal != null && m.total !== null;
            const baselineDelta = hasBaselineDelta ? (m.total as number) - (m.baselineTotal as number) : 0;
            const showBaselineDelta = hasBaselineDelta && Math.abs(baselineDelta) >= 0.005;
            const showOutlookDelta = primary.outlookDelta !== undefined && Math.abs(primary.outlookDelta) >= 0.005;
            return (
              <Link key={m.id} to={`/metrics?focus=${encodeURIComponent(m.id)}`} className="overview-kpi">
                <div className="overview-kpi-name">{m.name}</div>
                <div className="overview-kpi-data">
                  {primary.nowValue && (
                    <>
                      <span className="overview-kpi-now">{primary.nowValue}</span>
                      <span className="overview-kpi-sep" aria-hidden="true">›</span>
                    </>
                  )}
                  <span className="overview-kpi-outlook">{primary.value}</span>
                  {primary.nowValue && showOutlookDelta && (
                    <span className={`overview-kpi-delta ${primary.outlookDelta! > 0 ? 'up' : 'down'}`}>
                      {primary.outlookDelta! > 0 ? '↑' : '↓'}{Math.abs(primary.outlookDelta!).toFixed(2)}
                    </span>
                  )}
                  {!primary.nowValue && showBaselineDelta && (
                    <span className={`overview-kpi-delta ${baselineDelta > 0 ? 'up' : 'down'}`}>
                      {baselineDelta > 0 ? '↑' : '↓'}{Math.abs(baselineDelta).toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="overview-kpi-meta-right">
                  {primary.nowValue && m.updatedAt && (
                    <span className="overview-kpi-time">{timeAgo(m.updatedAt)}</span>
                  )}
                  {!primary.nowValue && (
                    <span className="overview-kpi-time overview-kpi-time-muted">{primary.label}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </section>
      )}

      {isAdmin && pending && pending.length > 0 && (
        <section className="overview-section">
          <header className="overview-section-head">
            <h2>Awaiting <span className="overview-count">{pending.length}</span></h2>
          </header>
          <ul className="overview-list">
            {pending.slice(0, 5).map(t => (
              <li key={t.id}>
                <Link to={`/proposals?id=${t.id}`} className="overview-row">
                  <span className="overview-row-text">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          {pending.length > 5 && (
            <Link to="/proposals" className="overview-more">View all {pending.length} →</Link>
          )}
        </section>
      )}

      <section className="overview-section">
        <header className="overview-section-head">
          <h2>Activity</h2>
          <Link to="/activity" className="overview-more">Full feed →</Link>
        </header>
        {activity == null ? null : activity.length === 0 ? (
          <p className="overview-muted">Quiet week.</p>
        ) : (
          <ul className="overview-list">
            {activity.map(item => {
              const summary = summarizeActivity(item);
              if (!summary) return null;
              const link = activityHref(item);
              const detail = activityDetail(item);
              const inner = (
                <div className="overview-row">
                  <span className="overview-row-text">{summary}</span>
                  {detail && <span className="overview-row-detail">{detail}</span>}
                  <span className="overview-row-meta">{timeAgo(item.timestamp)}</span>
                </div>
              );
              return (
                <li key={item.id}>
                  {link ? <Link to={link} className="overview-row-link">{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!isAdmin && (
        <p className="overview-muted">
          <Link to="/markets">Open markets →</Link>
        </p>
      )}
    </div>
  );
}
