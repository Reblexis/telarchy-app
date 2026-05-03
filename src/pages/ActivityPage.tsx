import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type ActivityItem } from '../lib/api';
import { FRIENDLY_ACTIVITY_TYPES, getActivityTags, summarizeActivity } from '../lib/activity-summary';

const TIME_RANGES: { label: string; hours: number }[] = [
  { label: '1h',  hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
];

function activityLink(item: ActivityItem): string | null {
  if (item.proposalId) return `/proposals?id=${encodeURIComponent(item.proposalId)}`;
  if (item.marketId) return `/markets?marketId=${encodeURIComponent(item.marketId)}`;
  if (item.metricId) return `/metrics`;
  return null;
}

export function ActivityPage() {
  const { user } = useAuth();
  const { workspace, loading: wsLoading } = useWorkspace(Boolean(user));

  const [rangeHours, setRangeHours] = useState<number>(24);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(FRIENDLY_ACTIVITY_TYPES.map(t => t.id)),
  );
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [feedError, setFeedError] = useState('');
  const [feedLoading, setFeedLoading] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceId = workspace?.workspaceId;

  const fetchActivity = useCallback(async () => {
    if (!workspaceId) return;
    setFeedLoading(true);
    try {
      const since = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      const allTypes = FRIENDLY_ACTIVITY_TYPES.length;
      const data = await api.getActivity(
        {
          since,
          limit: 200,
          types: selectedTypes.size === allTypes ? undefined : Array.from(selectedTypes),
        },
        workspaceId,
      );
      setActivities(data.activities);
      setFeedError('');
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedLoading(false);
    }
  }, [workspaceId, rangeHours, selectedTypes]);

  useEffect(() => {
    if (!workspaceId || paused) {
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
  }, [fetchActivity, workspaceId, paused]);

  const toggleType = (t: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const visibleActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter(item => {
      if (item.type === 'liquidity') {
        const amt = Number((item.data as { amount?: unknown }).amount ?? 0);
        if (Math.abs(amt) < 0.01) return false;
      }
      if (!q) return true;
      const summary = summarizeActivity(item).toLowerCase();
      const tags = getActivityTags(item).join(' ').toLowerCase();
      const actor = (item.actor?.label ?? '').toLowerCase();
      return summary.includes(q) || tags.includes(q) || actor.includes(q);
    });
  }, [activities, search]);

  const grouped = useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    let currentDay = '';
    for (const item of visibleActivities) {
      const day = new Date(item.timestamp).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      if (day !== currentDay) {
        out.push({ day, items: [item] });
        currentDay = day;
      } else {
        out[out.length - 1].items.push(item);
      }
    }
    return out;
  }, [visibleActivities]);

  if (!user || wsLoading) return <div className="loading">Loading…</div>;

  return (
    <div className="activity">
      <header className="activity-header">
        <h1>Activity</h1>
        <button
          type="button"
          className="activity-status"
          onClick={() => setPaused(p => !p)}
          title={paused ? 'Resume live updates' : 'Pause live updates'}
        >
          <span className={`activity-dot ${paused ? 'paused' : ''}`} />
          {paused ? 'Paused' : feedLoading ? 'Updating' : 'Live'}
        </button>
      </header>

      <div className="activity-toolbar">
        <input
          type="search"
          className="activity-search"
          placeholder="Search activity"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="activity-range">
          {TIME_RANGES.map(r => (
            <button
              key={r.hours}
              type="button"
              className={`activity-range-btn${rangeHours === r.hours ? ' active' : ''}`}
              onClick={() => setRangeHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="activity-filters">
          {FRIENDLY_ACTIVITY_TYPES.map(t => {
            const on = selectedTypes.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`activity-filter${on ? ' active' : ''}`}
                onClick={() => toggleType(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {feedError && <div className="error show">{feedError}</div>}

      {visibleActivities.length === 0 && !feedLoading ? (
        <p className="activity-empty">Nothing has happened in this range yet.</p>
      ) : (
        <div className="activity-feed">
          {grouped.map(group => (
            <section key={group.day} className="activity-group">
              <h2 className="activity-day">{group.day}</h2>
              <ul className="activity-list">
                {group.items.map(item => {
                  const summary = summarizeActivity(item);
                  if (!summary) return null;
                  const tags = getActivityTags(item);
                  const time = new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                  });
                  const link = activityLink(item);
                  const inner = (
                    <div className="activity-row">
                      <div className="activity-text">
                        <div>{summary}</div>
                        {tags.length > 0 && (
                          <div className="activity-tags">
                            {tags.map(tag => (
                              <span key={tag} className="activity-tag">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="activity-time">{time}</span>
                    </div>
                  );
                  return (
                    <li key={item.id}>
                      {link ? <Link to={link} className="activity-row-link">{inner}</Link> : inner}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
