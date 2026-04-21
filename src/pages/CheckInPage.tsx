import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useWorkspace } from '../hooks/useWorkspace';
import type { Metric, Market, Agent } from '../types';

function isLeaf(m: Metric): boolean {
  return !m.formula || m.formula.trim() === '0';
}

function formatRelative(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 100) / 100).toString();
}

interface MetricRowProps {
  metric: Metric;
  value: string;
  onChange: (v: string) => void;
}

function MetricCheckInRow({ metric, value, onChange }: MetricRowProps) {
  const rel = formatRelative(metric.updatedAt);
  const current = formatValue(metric.value);
  const dirty = value !== '' && !isNaN(parseFloat(value)) && parseFloat(value) !== metric.value;
  return (
    <div className={`checkin-card${dirty ? ' checkin-card--dirty' : ''}`}>
      <div className="checkin-card__heading">
        <div className="checkin-card__name">{metric.name}</div>
        {metric.description && (
          <div className="checkin-card__description">{metric.description}</div>
        )}
      </div>
      <div className="checkin-card__input-row">
        {metric.marketRangeMax != null && (
          <span className="checkin-card__range-label">0</span>
        )}
        <input
          type="number"
          step="any"
          className="checkin-card__input"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {metric.marketRangeMax != null && (
          <span className="checkin-card__range-label">{metric.marketRangeMax}</span>
        )}
      </div>
      <div className="checkin-card__meta">
        <span>Current <strong>{current}</strong></span>
        {rel && <span className="checkin-card__meta-sep" aria-hidden="true">·</span>}
        {rel && <span>Updated {rel}</span>}
      </div>
    </div>
  );
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
      <div className="container">
        <div className="section-header">
          <h2>Check-in</h2>
          <p className="section-subtitle">
            Only workspace admins can update metric values. You have trader access:
            you can forecast on the markets but not edit the underlying numbers.
            See the current values and forecasts on the <Link to="/metrics">Metrics page</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (leaves.length === 0) {
    return (
      <div className="container">
        <div className="section-header">
          <h2>Check-in</h2>
          <p className="section-subtitle">No leaf metrics to update. Create metrics on the Metrics page first.</p>
        </div>
      </div>
    );
  }

  const seedReserved = marketCount != null ? marketCount * 0.5 : null;

  return (
    <div className="container checkin-page">
      <div className="section-header">
        <h2>{isWelcome ? 'Where are you right now?' : 'Check-in'}</h2>
        <p className="section-subtitle">
          {isWelcome
            ? 'Set your starting point. Forecasts and predictions will build from here.'
            : 'Update any metric whenever the ground truth changes. Each card shows what the metric means so you can recall the definition as you record.'}
        </p>
      </div>

      {isWelcome && marketCount != null && marketCount > 0 && seedReserved != null && (
        <div className="checkin-callout">
          <div className="checkin-callout__title">Your credits</div>
          <div className="checkin-callout__body">
            {seedReserved.toFixed(1)} credits reserved as seed liquidity for {marketCount} market{marketCount === 1 ? '' : 's'}.
            {balance != null && <> You have <strong>{balance.toFixed(2)}</strong> credits left to trade.</>}
          </div>
        </div>
      )}

      {isWelcome && marketCount != null && marketCount > 0 && (
        <div className="checkin-callout checkin-callout--accent">
          <div className="checkin-callout__title">Bots arrive in about 5 minutes</div>
          <div className="checkin-callout__body">
            AI agents will start trading on your markets shortly. Watch consensus move on the Metrics page.
          </div>
        </div>
      )}

      {saved && !isWelcome && (
        <div className="message success show checkin-feedback">Values saved.</div>
      )}

      <form onSubmit={handleSubmit} className="checkin-form">
        <div className="checkin-list">
          {leaves.map(m => (
            <MetricCheckInRow
              key={m.id}
              metric={m}
              value={values[m.id] ?? ''}
              onChange={v => { setSaved(false); setValues(prev => ({ ...prev, [m.id]: v })); }}
            />
          ))}
        </div>

        {error && <div className="message error show checkin-feedback">{error}</div>}

        <div className="checkin-actions">
          <button type="submit" className="btn checkin-submit" disabled={saving}>
            {saving ? 'Saving...' : isWelcome ? 'Continue' : 'Save'}
          </button>
        </div>

        {isWelcome && (
          <p className="checkin-footnote">
            Your workspace is listed on the marketplace and open to participants. Change in <Link to="/settings">Settings</Link>.
          </p>
        )}
      </form>
    </div>
  );
}
