import { useState, useEffect, useRef, FormEvent } from 'react';
import type { Metric } from '../types';

interface UpdateValuesModalProps {
  open: boolean;
  metrics: Metric[];
  onClose: () => void;
  onSave: (updates: { metric: Metric; newValue: number }[]) => Promise<void>;
}

export function UpdateValuesModal({ open, metrics, onClose, onSave }: UpdateValuesModalProps) {
  const leaves = metrics.filter(m => !m.formula || m.formula.trim() === '0');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      for (const m of leaves) init[m.id] = String(m.value);
      setValues(init);
      setError('');
      setSaving(false);
      setTimeout(() => firstInputRef.current?.select(), 0);
    }
  }, [open, metrics]);

  if (!open || leaves.length === 0) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const updates: { metric: Metric; newValue: number }[] = [];
    for (const m of leaves) {
      const v = parseFloat(values[m.id] ?? '');
      if (isNaN(v)) continue;
      if (v !== m.value) updates.push({ metric: m, newValue: v });
    }
    if (updates.length === 0) { onClose(); return; }
    setSaving(true);
    try {
      await onSave(updates);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal show" onClick={handleOverlayClick}>
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Update values</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ overflowY: 'auto', maxHeight: '60vh', paddingRight: '0.25rem' }}>
          {leaves.map((m, i) => (
            <div key={m.id} className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ flex: 1, margin: 0 }} title={m.description || undefined}>{m.name}</label>
              <input
                ref={i === 0 ? firstInputRef : undefined}
                type="number"
                step="any"
                value={values[m.id] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [m.id]: e.target.value }))}
                style={{ width: '7rem', textAlign: 'right' }}
              />
            </div>
          ))}
          </div>
          {error && <div className="message error show" style={{ marginBottom: '0.75rem' }}>{error}</div>}
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  );
}
