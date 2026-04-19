import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Metric } from '../types';

const DEFAULT_INTERVAL_DAYS = 7;

function hoursSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return Infinity;
  return (Date.now() - then) / (1000 * 60 * 60);
}

function urgencyLabel(hoursLeft: number): { text: string; overdue: boolean } {
  if (!Number.isFinite(hoursLeft)) return { text: 'Never answered', overdue: true };
  if (hoursLeft <= 0) {
    const overdueH = -hoursLeft;
    if (overdueH < 24) return { text: `Overdue by ${Math.max(1, Math.round(overdueH))}h`, overdue: true };
    const days = Math.round(overdueH / 24);
    return { text: `Overdue by ${days}d`, overdue: true };
  }
  if (hoursLeft < 24) return { text: `${Math.max(1, Math.round(hoursLeft))}h left`, overdue: false };
  const days = Math.round(hoursLeft / 24);
  return { text: `${days}d left`, overdue: false };
}

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
}

function urgency(m: Metric): number {
  const interval = (m.checkInIntervalDays ?? DEFAULT_INTERVAL_DAYS) * 24;
  const elapsed = hoursSince(m.updatedAt ?? '');
  if (!Number.isFinite(elapsed)) return -Infinity;
  return interval - elapsed;
}

export function CheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMetrics().then((data: Metric[]) => {
      setMetrics(data);
      const init: Record<string, string> = {};
      for (const m of data) {
        if (isLeaf(m)) init[m.id] = String(m.value);
      }
      setValues(init);
    }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const leaves = metrics.filter(isLeaf);
  const sortedLeaves = isWelcome
    ? leaves
    : [...leaves].sort((a, b) => urgency(a) - urgency(b));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      for (const m of leaves) {
        const v = parseFloat(values[m.id] ?? '');
        if (isNaN(v) || v === m.value) continue;
        await api.updateMetric(m.id, {
          name: m.name,
          description: m.description || '',
          question: m.question || '',
          value: v,
          formula: m.formula || '0',
          oldValue: m.value,
          updateNote: 'Check-in',
          timePreference: m.timePreference ?? null,
          marketRangeMax: m.marketRangeMax,
          checkInIntervalDays: m.checkInIntervalDays,
        });
      }
      if (isWelcome) {
        navigate('/metrics');
        return;
      }
      setSaved(true);
      const fresh = await api.getMetrics() as Metric[];
      setMetrics(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container"><p>Loading...</p></div>;

  if (leaves.length === 0) {
    return (
      <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
        <h1>Check-in</h1>
        <p style={{ color: 'var(--text-secondary)' }}>No leaf metrics to update. Create metrics on the Metrics page first.</p>
      </div>
    );
  }

  if (isWelcome) {
    return (
      <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
        <h1>Where are you right now?</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Set your starting point. Forecasts and predictions will build from here.
        </p>
        <form onSubmit={handleSubmit}>
          {sortedLeaves.map(m => (
            <div key={m.id} className="checkin-card" style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '1rem',
              marginBottom: '0.75rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {m.question || m.name}
              </div>
              {m.question && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                  {m.name}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {m.marketRangeMax != null && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', minWidth: '1.5rem', textAlign: 'right' }}>0</span>
                )}
                <input
                  type="number"
                  step="any"
                  value={values[m.id] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [m.id]: e.target.value }))}
                  style={{ flex: 1, fontSize: '1.1rem', padding: '0.5rem', textAlign: 'center' }}
                />
                {m.marketRangeMax != null && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', minWidth: '1.5rem' }}>{m.marketRangeMax}</span>
                )}
              </div>
            </div>
          ))}
          {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
          <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </div>
    );
  }

  const overdueCount = sortedLeaves.filter(m => urgency(m) <= 0).length;

  return (
    <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
      <h1>Check-in</h1>
      {saved && (
        <div className="message success show" style={{ marginBottom: '1rem' }}>Values saved.</div>
      )}
      {!saved && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          {overdueCount > 0
            ? `${overdueCount} metric${overdueCount !== 1 ? 's' : ''} overdue. Sorted by time remaining.`
            : 'Answer any metric whenever you like. Sorted by time remaining.'}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {sortedLeaves.map(m => {
          const intervalHours = (m.checkInIntervalDays ?? DEFAULT_INTERVAL_DAYS) * 24;
          const elapsed = hoursSince(m.updatedAt ?? '');
          const hoursLeft = Number.isFinite(elapsed) ? intervalHours - elapsed : -Infinity;
          const { text: urgencyText, overdue } = urgencyLabel(hoursLeft);
          return (
            <div key={m.id} className="checkin-card" style={{
              border: `1px solid ${overdue ? 'var(--error-text)' : 'var(--border-color)'}`,
              borderRadius: '0.5rem',
              padding: '1rem',
              marginBottom: '0.75rem',
              background: overdue ? 'var(--bg-elevated, var(--bg-secondary))' : undefined,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <div style={{ fontWeight: 600 }}>
                  {m.question || m.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: overdue ? 'var(--error-text)' : 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {urgencyText}
                </div>
              </div>
              {m.question && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                  {m.name}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {m.marketRangeMax != null && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', minWidth: '1.5rem', textAlign: 'right' }}>0</span>
                )}
                <input
                  type="number"
                  step="any"
                  value={values[m.id] ?? ''}
                  onChange={e => { setSaved(false); setValues(prev => ({ ...prev, [m.id]: e.target.value })); }}
                  style={{ flex: 1, fontSize: '1.1rem', padding: '0.5rem', textAlign: 'center' }}
                />
                {m.marketRangeMax != null && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', minWidth: '1.5rem' }}>{m.marketRangeMax}</span>
                )}
              </div>
            </div>
          );
        })}
        {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}
