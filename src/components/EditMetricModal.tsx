import { useState, useEffect, FormEvent } from 'react';
import type { Metric, TimePreference } from '../types';

interface EditMetricModalProps {
  metric: Metric | null;
  onClose: () => void;
  onSave: (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference: TimePreference | null,
  ) => Promise<void>;
}

export function EditMetricModal({ metric, onClose, onSave }: EditMetricModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [formula, setFormula] = useState('0');
  const [updateNote, setUpdateNote] = useState('');
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpHalfLife, setTpHalfLife] = useState('1');

  useEffect(() => {
    if (metric) {
      setName(metric.name);
      setDescription(metric.description || '');
      setValue(String(metric.value));
      setFormula(metric.formula || '0');
      setUpdateNote('');
      setTpEnabled(metric.timePreference?.enabled ?? false);
      setTpHalfLife(String(metric.timePreference?.halfLife ?? 1));
    }
  }, [metric]);

  if (!metric) return null;

  const isLeaf = !formula || formula.trim() === '0';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const tp: TimePreference | null = tpEnabled && !isLeaf
      ? { enabled: true, halfLife: Math.max(0.01, Number(tpHalfLife)) }
      : null;
    await onSave(metric.id, name, description, Number(value), formula, metric.value, updateNote, tp);
    onClose();
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
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isLeaf ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={tpEnabled && !isLeaf}
                disabled={isLeaf}
                onChange={e => setTpEnabled(e.target.checked)}
              />
              Time Preference
              {isLeaf && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                  (requires a formula)
                </span>
              )}
            </label>
            {tpEnabled && !isLeaf && (
              <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="editHalfLife" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  Half-life (years)
                </label>
                <input
                  type="number" id="editHalfLife" step="0.01" min="0.01"
                  value={tpHalfLife}
                  onChange={e => setTpHalfLife(e.target.value)}
                  style={{ width: '80px' }}
                />
              </div>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="editUpdateNote">Update Note (optional)</label>
            <textarea id="editUpdateNote" placeholder="Describe what changed and why..." value={updateNote} onChange={e => setUpdateNote(e.target.value)} />
          </div>
          <button type="submit" className="btn">Save Changes</button>
        </form>
      </div>
    </div>
  );
}
