import { useState, useEffect, FormEvent } from 'react';
import type { Metric } from '../types';

interface EditMetricModalProps {
  metric: Metric | null;
  onClose: () => void;
  onSave: (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string
  ) => Promise<void>;
}

export function EditMetricModal({ metric, onClose, onSave }: EditMetricModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [formula, setFormula] = useState('0');
  const [updateNote, setUpdateNote] = useState('');

  useEffect(() => {
    if (metric) {
      setName(metric.name);
      setDescription(metric.description || '');
      setValue(String(metric.value));
      setFormula(metric.formula || '0');
      setUpdateNote('');
    }
  }, [metric]);

  if (!metric) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSave(metric.id, name, description, Number(value), formula, metric.value, updateNote);
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
          <div className="form-group">
            <label htmlFor="editValue">Base Value</label>
            <input type="number" id="editValue" step="any" required value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="editFormula">Formula</label>
            <textarea id="editFormula" placeholder="e.g., {Deep Work} + {Exercise} * 2" value={formula} onChange={e => setFormula(e.target.value)} />
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
