import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react';
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
  onCommit: () => void;
  saving: boolean;
  savedFlash: boolean;
  rowError: string | null;
}

function MetricCheckInRow({ metric, value, onChange, onCommit, saving, savedFlash, rowError }: MetricRowProps) {
  const rel = formatRelative(metric.updatedAt);
  const current = formatValue(metric.value);
  const parsed = parseFloat(value);
  const dirty = value !== '' && !isNaN(parsed) && parsed !== metric.value;
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  };
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
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          disabled={saving}
        />
        {metric.marketRangeMax != null && (
          <span className="checkin-card__range-label">{metric.marketRangeMax}</span>
        )}
      </div>
      <div className="checkin-card__meta">
        <span>Current <strong>{current}</strong></span>
        {rel && <span className="checkin-card__meta-sep" aria-hidden="true">·</span>}
        {rel && <span>Updated {rel}</span>}
        <span className="checkin-card__status">
          {saving && <span className="checkin-card__status-text">Saving…</span>}
          {!saving && savedFlash && <span className="checkin-card__status-text checkin-card__status-text--saved">Saved</span>}
          {!saving && rowError && <span className="checkin-card__status-text checkin-card__status-text--error">{rowError}</span>}
        </span>
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
  const [error, setError] = useState('');
  const [marketCount, setMarketCount] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Tracks which inputs the user has actually edited in this session.
  // Lets us treat a same-value blur as a "still correct" confirmation
  // (bumps updatedAt) without treating an idle tab-through as one.
  const [touchedIds, setTouchedIds] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);
  const [welcomeSubmitting, setWelcomeSubmitting] = useState(false);
  const metricsRef = useRef<Metric[]>([]);
  metricsRef.current = metrics;

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

  // Re-render every second so "Saved" pips fade out (2.5s lifetime).
  useEffect(() => {
    if (Object.keys(savedAt).length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [savedAt]);

  const leaves = metrics.filter(isLeaf);

  const saveMetric = async (metric: Metric, rawValue: string) => {
    const v = parseFloat(rawValue);
    if (isNaN(v)) {
      setRowErrors(prev => ({ ...prev, [metric.id]: 'Enter a number' }));
      return;
    }
    // If value is unchanged AND the user never typed in this field this
    // session, treat it as an idle tab-through and skip the save.
    // If they edited (even to land on the same value), it counts as a
    // "still correct" confirmation that bumps updatedAt server-side.
    if (v === metric.value && !touchedIds[metric.id]) return;
    setRowErrors(prev => { const { [metric.id]: _, ...rest } = prev; return rest; });
    setSavingIds(prev => ({ ...prev, [metric.id]: true }));
    try {
      await api.updateMetric(metric.id, {
        name: metric.name,
        description: metric.description || '',
        value: v,
        formula: metric.formula || '0',
        oldValue: metric.value,
        updateNote: 'Check-in',
        timePreference: metric.timePreference ?? null,
        marketRangeMax: metric.marketRangeMax,
      });
      setMetrics(prev => prev.map(m => m.id === metric.id
        ? { ...m, value: v, updatedAt: new Date().toISOString() }
        : m));
      setValues(prev => ({ ...prev, [metric.id]: String(v) }));
      setSavedAt(prev => ({ ...prev, [metric.id]: Date.now() }));
      setTouchedIds(prev => { const { [metric.id]: _, ...rest } = prev; return rest; });
    } catch (e) {
      setRowErrors(prev => ({ ...prev, [metric.id]: e instanceof Error ? e.message : 'Save failed' }));
    } finally {
      setSavingIds(prev => { const { [metric.id]: _, ...rest } = prev; return rest; });
    }
  };

  const handleWelcomeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setWelcomeSubmitting(true);
    try {
      for (const m of metricsRef.current.filter(isLeaf)) {
        const raw = values[m.id] ?? '';
        const v = parseFloat(raw);
        if (isNaN(v)) continue;
        if (v === m.value && !touchedIds[m.id]) continue;
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
      navigate('/metrics');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setWelcomeSubmitting(false);
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
  const now = Date.now();
  const SAVED_FLASH_MS = 2500;
  void tick;

  const rows = leaves.map(m => (
    <MetricCheckInRow
      key={m.id}
      metric={m}
      value={values[m.id] ?? ''}
      onChange={v => {
        setValues(prev => ({ ...prev, [m.id]: v }));
        setTouchedIds(prev => ({ ...prev, [m.id]: true }));
        if (rowErrors[m.id]) {
          setRowErrors(prev => { const { [m.id]: _, ...rest } = prev; return rest; });
        }
      }}
      onCommit={() => saveMetric(m, values[m.id] ?? '')}
      saving={!!savingIds[m.id]}
      savedFlash={savedAt[m.id] != null && now - savedAt[m.id] < SAVED_FLASH_MS}
      rowError={rowErrors[m.id] || null}
    />
  ));

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
            Participants, human or AI, will start trading on your markets shortly. Watch consensus move on the Metrics page.
          </div>
        </div>
      )}

      {error && <div className="message error show checkin-feedback">{error}</div>}

      {isWelcome ? (
        <form onSubmit={handleWelcomeSubmit} className="checkin-form">
          <div className="checkin-list">{rows}</div>
          <div className="checkin-actions">
            <button type="submit" className="btn checkin-submit" disabled={welcomeSubmitting}>
              {welcomeSubmitting ? 'Saving...' : 'Continue'}
            </button>
          </div>
          <p className="checkin-footnote">
            Your workspace is listed on the marketplace and open to participants. Change in <Link to="/settings">Settings</Link>.
          </p>
        </form>
      ) : (
        <div className="checkin-form">
          <div className="checkin-list">{rows}</div>
          <p className="checkin-footnote checkin-footnote--muted">
            Changes save automatically when you leave a field or press Enter.
          </p>
        </div>
      )}
    </div>
  );
}
