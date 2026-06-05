import { useState, useEffect, FormEvent } from 'react';
import type { Metric, TimePreference } from '../types';

const UNIT_TO_YEARS: Record<string, number> = {
  d: 1 / 365, w: 7 / 365, mo: 1 / 12, m: 1 / 12, y: 1,
};

function parseHalfLife(input: string): number | null {
  const m = input.trim().toLowerCase().replace(',', '.').match(/^([0-9]*\.?[0-9]+)\s*(d|w|mo|m|y)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * UNIT_TO_YEARS[m[2] ?? 'y'];
}

function formatHalfLife(years: number): string {
  const round = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  if (years >= 1) return `${round(years)}y`;
  const months = years * 12;
  if (months >= 1 && Math.abs(months - Math.round(months)) < 0.01) return `${Math.round(months)}mo`;
  const weeks = years * 365 / 7;
  if (weeks >= 1 && Math.abs(weeks - Math.round(weeks)) < 0.01) return `${Math.round(weeks)}w`;
  const days = years * 365;
  if (days >= 1) return `${Math.round(days)}d`;
  return round(years);
}

const HORIZON_REL_RE = /^\+(\d+)(d|w|m|y)$/;
export const MAX_CUSTOM_HORIZONS = 24;

/**
 * Format-only validation plus a simple future check. The server's
 * parseTimePreference is the source of truth; this just catches typos early.
 * Returns an error message, or null when the entry looks valid.
 */
export function customHorizonError(entry: string): string | null {
  const rel = entry.match(HORIZON_REL_RE);
  if (rel) {
    return parseInt(rel[1], 10) >= 1 ? null : 'Offset must be at least 1';
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (/^\d{4}$/.test(entry)) {
    return parseInt(entry, 10) >= now.getFullYear() ? null : 'Date is in the past';
  }
  if (/^\d{4}-\d{2}$/.test(entry)) {
    const m = parseInt(entry.slice(5), 10);
    if (m < 1 || m > 12) return 'Invalid month';
    return entry >= today.slice(0, 7) ? null : 'Date is in the past';
  }
  if (/^\d{4}-W\d{2}$/.test(entry)) {
    const w = parseInt(entry.split('-W')[1], 10);
    if (w < 1 || w > 53) return 'Invalid week';
    return parseInt(entry.slice(0, 4), 10) >= now.getFullYear() ? null : 'Date is in the past';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
    const [y, m, d] = entry.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return 'Invalid date';
    return entry > today ? null : 'Date must be in the future';
  }
  return 'Use +3m, +2w, 2026-09, 2026-W40 or 2026-09-15';
}

/** Best-effort resolved-date hint for a relative entry ("+3m -> Sep 2026"). */
function resolveHorizonHint(entry: string): string | null {
  const rel = entry.match(HORIZON_REL_RE);
  if (!rel) return null;
  const n = parseInt(rel[1], 10);
  const unit = rel[2];
  const d = new Date();
  if (unit === 'd') d.setDate(d.getDate() + n);
  if (unit === 'w') d.setDate(d.getDate() + n * 7);
  if (unit === 'm') d.setMonth(d.getMonth() + n);
  if (unit === 'y') d.setFullYear(d.getFullYear() + n);
  const opts: Intl.DateTimeFormatOptions = unit === 'd' || unit === 'w'
    ? { year: 'numeric', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: unit === 'y' ? undefined : 'short' };
  return d.toLocaleDateString(undefined, opts);
}

interface EditMetricModalProps {
  metric: Metric | null;
  onClose: () => void;
  onSave: (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference: TimePreference | null,
    marketRangeMax?: number,
  ) => Promise<void>;
}

export function EditMetricModal({ metric, onClose, onSave }: EditMetricModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [formula, setFormula] = useState('0');
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpHalfLife, setTpHalfLife] = useState('1');
  const [tpDensity, setTpDensity] = useState('3');
  const [customHorizons, setCustomHorizons] = useState<string[]>([]);
  const [horizonInput, setHorizonInput] = useState('');
  const [horizonError, setHorizonError] = useState('');
  const [marketRangeMax, setMarketRangeMax] = useState('1000');
  const [error, setError] = useState('');

  useEffect(() => {
    if (metric) {
      setName(metric.name);
      setDescription(metric.description || '');
      setValue(String(metric.value));
      setFormula(metric.formula || '0');
      setTpEnabled(metric.timePreference?.enabled ?? false);
      setTpHalfLife(formatHalfLife(metric.timePreference?.halfLife ?? 1));
      setTpDensity(String(metric.timePreference?.density ?? 3));
      setCustomHorizons(metric.timePreference?.customHorizons ?? []);
      setHorizonInput('');
      setHorizonError('');
      setMarketRangeMax(String(metric.marketRangeMax ?? 1000));
      setError('');
    }
  }, [metric]);

  if (!metric) return null;

  const isLeaf = !formula || formula.trim() === '0';

  const addHorizon = () => {
    const entry = horizonInput.trim();
    if (!entry) return;
    const err = customHorizonError(entry);
    if (err) { setHorizonError(err); return; }
    if (customHorizons.includes(entry)) { setHorizonError('Already added'); return; }
    if (customHorizons.length >= MAX_CUSTOM_HORIZONS) {
      setHorizonError(`At most ${MAX_CUSTOM_HORIZONS} custom dates`);
      return;
    }
    setCustomHorizons([...customHorizons, entry]);
    setHorizonInput('');
    setHorizonError('');
  };

  const removeHorizon = (entry: string) => {
    setCustomHorizons(customHorizons.filter(h => h !== entry));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const parsedHl = parseHalfLife(tpHalfLife);
    if (tpEnabled && parsedHl === null) {
      setError('Half-life must be a positive number, optionally with d / w / mo / y (e.g. 6mo, 30d, 0.5y)');
      return;
    }
    const tp: TimePreference | null = (tpEnabled || customHorizons.length > 0)
      ? {
          enabled: tpEnabled,
          halfLife: tpEnabled ? Math.max(1 / 365, parsedHl!) : 1,
          density: Math.max(1, Math.floor(Number(tpDensity) || 3)),
          ...(customHorizons.length > 0 ? { customHorizons } : {}),
        }
      : null;
    try {
      const rmx = isLeaf ? Math.max(1, Number(marketRangeMax) || 1000) : undefined;
      await onSave(metric.id, name, description, Number(value), formula, metric.value, '', tp, rmx);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Edit Metric</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="editName">Name</label>
            <input type="text" id="editName" required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="editDescription">Description</label>
            <textarea id="editDescription" placeholder="What does this metric represent?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          {isLeaf && (
            <div className="form-group">
              <label htmlFor="editValue">Value</label>
              <input type="number" id="editValue" step="any" required value={value} onChange={e => setValue(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="editFormula">Formula</label>
            <textarea id="editFormula" placeholder="e.g., {Deep Work} + {Exercise} * 2" value={formula} onChange={e => setFormula(e.target.value)} />
          </div>
          {isLeaf && (
            <div className="form-group">
              <label htmlFor="editMarketRangeMax" title="The highest value this metric could realistically reach. Used to scale the prediction market.">Max expected value</label>
              <input type="number" id="editMarketRangeMax" step="any" min="1" value={marketRangeMax} onChange={e => setMarketRangeMax(e.target.value)} />
            </div>
          )}
          <div className="form-group tp-row">
            <div className="tp-toggle">
              <span className="tp-label">
                Time Preference
              </span>
              <label className="tp-switch">
                <input
                  type="checkbox"
                  checked={tpEnabled}
                  onChange={e => setTpEnabled(e.target.checked)}
                />
                <span className="tp-slider" />
              </label>
            </div>
            {tpEnabled && (
              <div className="tp-halflife">
                <label htmlFor="editHalfLife">Half-life</label>
                <input
                  type="text" id="editHalfLife" inputMode="decimal"
                  placeholder="e.g. 6mo, 30d, 0.5y"
                  value={tpHalfLife}
                  onChange={e => setTpHalfLife(e.target.value)}
                  className="tp-halflife-input"
                />
              </div>
            )}
            {tpEnabled && (
              <div className="tp-halflife">
                <label htmlFor="editTpDensity" title="How many markets to spawn per leaf descendant. Higher = more granular forecasts, more markets.">Market density</label>
                <input
                  type="number" id="editTpDensity" step="1" min="1" max="50"
                  value={tpDensity}
                  onChange={e => setTpDensity(e.target.value)}
                  className="tp-halflife-input"
                />
              </div>
            )}
            <div className="tp-horizons">
              <label htmlFor="editHorizonInput" title="Extra market dates beyond the curve. Offsets like +3m are rolling (always a market ~3 months out); specific dates are one-shot.">
                Custom market dates
              </label>
              {customHorizons.length > 0 && (
                <div className="tp-horizon-chips">
                  {customHorizons.map(h => (
                    <span key={h} className="tp-horizon-chip" title={resolveHorizonHint(h) ?? undefined}>
                      {h}
                      <button type="button" className="tp-horizon-remove" aria-label={`Remove ${h}`} onClick={() => removeHorizon(h)}>&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="tp-horizon-add">
                <input
                  type="text" id="editHorizonInput" className="tp-halflife-input"
                  placeholder="+3m or 2026-09-15"
                  value={horizonInput}
                  onChange={e => { setHorizonInput(e.target.value); setHorizonError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHorizon(); } }}
                />
                <button type="button" className="btn btn-secondary tp-horizon-add-btn" onClick={addHorizon}>Add</button>
              </div>
              {horizonError && <span className="tp-horizon-error">{horizonError}</span>}
            </div>
            {(tpEnabled || customHorizons.length > 0) && (() => {
              const offsets: string[] = [];
              if (tpEnabled) {
                const hl = parseHalfLife(tpHalfLife) ?? 1;
                const n = Math.max(1, Math.floor(Number(tpDensity) || 3));
                const lambda = Math.LN2 / hl;
                for (let i = 0; i < n; i++) {
                  const p = (2 * i + 1) / (2 * n);
                  const days = Math.max(1, Math.round((-Math.log(1 - p)) / lambda * 365));
                  if (days < 14) offsets.push(`${days}d`);
                  else if (days < 60) offsets.push(`${Math.round(days / 7)}w`);
                  else if (days < 730) offsets.push(`${Math.round(days / 30)}mo`);
                  else offsets.push(`${Math.round(days / 365)}y`);
                }
              }
              const customs = customHorizons.map(h => {
                const hint = resolveHorizonHint(h);
                return hint ? `${h} (${hint})` : h;
              });
              return (
                <div className="tp-preview">
                  <span className="tp-preview-label">Market offsets</span>
                  <span className="tp-preview-dates">
                    {[...offsets, ...customs].join(', ')}
                  </span>
                </div>
              );
            })()}
          </div>
          {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
          <button type="submit" className="btn">Save Changes</button>
        </form>
      </div>
    </div>
  );
}
