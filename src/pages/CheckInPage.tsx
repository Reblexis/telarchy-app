import { useState, useEffect, FormEvent } from 'react';
import { api } from '../lib/api';
import type { Metric } from '../types';

const STALE_DAYS = 7;

function daysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function stalenessLabel(days: number): string {
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return `Updated ${days} days ago`;
  if (days < 30) return `Updated ${Math.floor(days / 7)} weeks ago`;
  return `Updated ${Math.floor(days / 30)} months ago`;
}

export function CheckInPage() {
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
  const dueLeaves = leaves.filter(m => {
    // updatedAt is a rough proxy; any leaf not updated in STALE_DAYS is due
    const days = daysSince(m.updatedAt ?? '');
    return days >= STALE_DAYS;
  });
  const freshLeaves = leaves.filter(m => !dueLeaves.includes(m));

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
        });
      }
      setSaved(true);
      // Reload to get fresh updatedAt
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

  const metricsToShow = dueLeaves.length > 0 ? dueLeaves : leaves;
  const showingAll = dueLeaves.length === 0;

  return (
    <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
      <h1>Check-in</h1>
      {saved && (
        <div className="message success show" style={{ marginBottom: '1rem' }}>Values saved.</div>
      )}
      {!saved && dueLeaves.length > 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          {dueLeaves.length} metric{dueLeaves.length !== 1 ? 's' : ''} due for update.
        </p>
      )}
      {!saved && showingAll && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          All metrics are up to date. You can still update them.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {metricsToShow.map(m => {
          const days = daysSince(m.updatedAt ?? '');
          const isDue = days >= STALE_DAYS;
          return (
            <div key={m.id} className="checkin-card" style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '1rem',
              marginBottom: '0.75rem',
              background: isDue ? 'var(--bg-elevated, var(--bg-secondary))' : undefined,
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {m.question || m.name}
              </div>
              {m.question && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
                  {m.name}
                </div>
              )}
              <div style={{ fontSize: '0.75rem', color: isDue ? 'var(--error-text)' : 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                {isFinite(days) ? stalenessLabel(days) : 'Never updated'}
                {m.marketRangeMax != null && ` · 0\u2013${m.marketRangeMax}`}
              </div>
              <input
                type="number"
                step="any"
                value={values[m.id] ?? ''}
                onChange={e => { setSaved(false); setValues(prev => ({ ...prev, [m.id]: e.target.value })); }}
                style={{ width: '100%', fontSize: '1.1rem', padding: '0.5rem' }}
              />
            </div>
          );
        })}
        {!saved && freshLeaves.length > 0 && dueLeaves.length > 0 && (
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {freshLeaves.length} up-to-date metric{freshLeaves.length !== 1 ? 's' : ''}
            </summary>
            <div style={{ marginTop: '0.5rem' }}>
              {freshLeaves.map(m => (
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
                      {m.name}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                    {stalenessLabel(daysSince(m.updatedAt ?? ''))}
                    {m.marketRangeMax != null && ` · 0\u2013${m.marketRangeMax}`}
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={values[m.id] ?? ''}
                    onChange={e => { setSaved(false); setValues(prev => ({ ...prev, [m.id]: e.target.value })); }}
                    style={{ width: '100%', fontSize: '1.1rem', padding: '0.5rem' }}
                  />
                </div>
              ))}
            </div>
          </details>
        )}
        {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
}
