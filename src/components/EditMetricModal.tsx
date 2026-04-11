import { useState, useEffect, FormEvent } from 'react';
import type { Metric, TimePreference } from '../types';

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
  const [marketRangeMax, setMarketRangeMax] = useState('1000');
  const [error, setError] = useState('');

  useEffect(() => {
    if (metric) {
      setName(metric.name);
      setDescription(metric.description || '');
      setValue(String(metric.value));
      setFormula(metric.formula || '0');
      setTpEnabled(metric.timePreference?.enabled ?? false);
      setTpHalfLife(String(metric.timePreference?.halfLife ?? 1));
      setMarketRangeMax(String(metric.marketRangeMax ?? 1000));
      setError('');
    }
  }, [metric]);

  if (!metric) return null;

  const isLeaf = !formula || formula.trim() === '0';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const tp: TimePreference | null = tpEnabled
      ? { enabled: true, halfLife: Math.max(0.01, Number(tpHalfLife)) }
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
                <label htmlFor="editHalfLife">Half-life (years)</label>
                <input
                  type="number" id="editHalfLife" step="0.01" min="0.01"
                  value={tpHalfLife}
                  onChange={e => setTpHalfLife(e.target.value)}
                  className="tp-halflife-input"
                />
              </div>
            )}
            {tpEnabled && (() => {
              const hl = Math.max(0.01, Number(tpHalfLife) || 1);
              const lambda = Math.LN2 / hl;
              const offsets = Array.from({ length: 10 }, (_, i) => {
                const p = (2 * i + 1) / 20;
                const days = Math.max(1, Math.round((-Math.log(1 - p)) / lambda * 365));
                if (days < 14) return `${days}d`;
                if (days < 60) return `${Math.round(days / 7)}w`;
                if (days < 730) return `${Math.round(days / 30)}mo`;
                return `${Math.round(days / 365)}y`;
              });
              return (
                <div className="tp-preview">
                  <span className="tp-preview-label">Market offsets</span>
                  <span className="tp-preview-dates">{offsets.join(', ')}</span>
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
