import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Metric, Market, Agent } from '../types';

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
}

export function CheckInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const { workspace } = useWorkspace();
  const isAdmin = workspace?.tier === 'admin';
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [marketCount, setMarketCount] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

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

  useEffect(() => {
    if (!isWelcome) return;
    api.getMarkets().then((data) => {
      const markets = data as Market[];
      setMarketCount(markets.length);
    }).catch((e: Error) => console.error('getMarkets failed:', e.message));
    api.getParticipant().then((p) => {
      const agent = p as Agent;
      setBalance(agent.balance);
    }).catch((e: Error) => console.error('getParticipant failed:', e.message));
  }, [isWelcome]);

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

  if (!isAdmin && workspace) {
    return (
      <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
        <h1>Check-in</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Only workspace admins can update metric values. You have trader access:
          you can forecast on the markets but not edit the underlying numbers.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          See the current values and forecasts on the{' '}
          <Link to="/metrics" style={{ color: 'inherit', textDecoration: 'underline' }}>Metrics page</Link>.
        </p>
      </div>
    );
  }

  if (leaves.length === 0) {
    return (
      <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
        <h1>Check-in</h1>
        <p style={{ color: 'var(--text-secondary)' }}>No leaf metrics to update. Create metrics on the Metrics page first.</p>
      </div>
    );
  }

  if (isWelcome) {
    const seedReserved = marketCount != null ? marketCount * 0.5 : null;
    return (
      <div className="container" style={{ maxWidth: 500, paddingTop: '2rem' }}>
        <h1>Where are you right now?</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Set your starting point. Forecasts and predictions will build from here.
        </p>

        {marketCount != null && marketCount > 0 && seedReserved != null && (
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '0.5rem',
            padding: '0.75rem 1rem',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Your credits</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {seedReserved.toFixed(1)} credits reserved as seed liquidity for {marketCount} market{marketCount === 1 ? '' : 's'}.
              {balance != null && <> You have <strong>{balance.toFixed(2)}</strong> credits left to trade.</>}
            </div>
          </div>
        )}

        {marketCount != null && marketCount > 0 && (
          <div style={{
            background: 'var(--focus-bg)',
            border: '1px solid var(--focus-border)',
            borderRadius: '0.5rem',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Bots arrive in about 5 minutes</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              AI agents will start trading on your markets shortly. Watch consensus move on the Metrics page.
            </div>
          </div>
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
          <p style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            marginTop: '1rem',
            textAlign: 'center',
          }}>
            Your workspace is listed on the marketplace and open to participants. Change in{' '}
            <a href="/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>Settings</a>.
          </p>
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
