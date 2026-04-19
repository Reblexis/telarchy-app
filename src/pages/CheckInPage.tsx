import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Metric } from '../types';

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
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
          value: v,
          formula: m.formula || '0',
          oldValue: m.value,
          updateNote: 'Check-in',
          timePreference: m.timePreference ?? null,
          marketRangeMax: m.marketRangeMax,
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
          {leaves.map(m => (
            <div key={m.id} className="checkin-card" style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '1rem',
              marginBottom: '0.75rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                {m.name}
              </div>
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

  return (
    <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
      <h1>Check-in</h1>
      {saved && (
        <div className="message success show" style={{ marginBottom: '1rem' }}>Values saved.</div>
      )}
      {!saved && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Update any metric whenever you like.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {leaves.map(m => (
          <div key={m.id} className="checkin-card" style={{
            border: '1px solid var(--border-color)',
            borderRadius: '0.5rem',
            padding: '1rem',
            marginBottom: '0.75rem',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              {m.name}
            </div>
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
        ))}
        {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <button type="submit" className="btn" disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
}
