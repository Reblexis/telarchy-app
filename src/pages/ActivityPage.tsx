import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { api, type ActivityItem } from '../lib/api';
import {
  FRIENDLY_ACTIVITY_TYPES,
  ACTIVITY_TYPE_COLOR,
  ACTIVITY_TYPE_LABEL,
  summarizeActivity,
} from '../lib/activity-summary';

const TIME_RANGES: { label: string; hours: number }[] = [
  { label: '1 hour',  hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days',   hours: 168 },
  { label: '30 days',  hours: 720 },
];

export function ActivityPage() {
  const { user } = useAuth();
  const { workspace, loading: wsLoading } = useWorkspace(Boolean(user));

  const [rangeHours, setRangeHours] = useState<number>(24);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(FRIENDLY_ACTIVITY_TYPES.map(t => t.id)),
  );
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

  const grouped = useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    let currentDay = '';
    for (const item of activities) {
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
  }, [activities]);

  if (!user || wsLoading) return <div className="loading">Loading…</div>;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Activity</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {feedLoading ? 'Refreshing…' : paused ? 'Paused' : 'Live'}
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
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1rem' }}>
        What participants have been doing in this workspace.
      </p>

      <div className="section">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Range</label>
          <select
            value={rangeHours}
            onChange={e => setRangeHours(Number(e.target.value))}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', fontSize: '0.85rem' }}
          >
            {TIME_RANGES.map(r => <option key={r.hours} value={r.hours}>{r.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {FRIENDLY_ACTIVITY_TYPES.map(t => {
            const on = selectedTypes.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleType(t.id)}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.25rem 0.6rem',
                  border: `1px solid ${on ? t.color : 'var(--border-color)'}`,
                  borderRadius: 'var(--radius-full, 999px)',
                  background: on ? t.color : 'var(--bg-secondary)',
                  color: on ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: on ? 600 : 500,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {feedError && <div className="error show" style={{ marginBottom: '1rem' }}>{feedError}</div>}

        {activities.length === 0 && !feedLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Nothing has happened in this range yet.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--border-color)' }}>
            {grouped.map(group => (
              <div key={group.day}>
                <div style={{
                  padding: '0.6rem 0.5rem 0.3rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  {group.day}
                </div>
                {group.items.map(item => {
                  const color = ACTIVITY_TYPE_COLOR[item.type] ?? 'var(--text-tertiary)';
                  const label = ACTIVITY_TYPE_LABEL[item.type] ?? item.type;
                  const time = new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                  });
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '4px 90px 60px 1fr',
                        gap: '0.6rem',
                        alignItems: 'baseline',
                        padding: '0.55rem 0.5rem',
                        borderBottom: '1px solid var(--border-color)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div style={{ background: color, alignSelf: 'stretch', borderRadius: 2 }} />
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}>
                        {label}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                        {time}
                      </span>
                      <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        {summarizeActivity(item)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
