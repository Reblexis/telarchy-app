import { useState, FormEvent } from 'react';

interface AddMetricFormProps {
  onAdd: (name: string, description: string, value: number, formula: string) => Promise<void>;
}

export function AddMetricForm({ onAdd }: AddMetricFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [formula, setFormula] = useState('');

  const isLeaf = !formula || formula.trim() === '0';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onAdd(name, description, isLeaf ? Number(value) : 0, formula || '0');
    setName('');
    setDescription('');
    setValue('');
    setFormula('');
  };

  return (
    <div className="section">
      <h2>Add New Metric</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="metricName">Metric Name</label>
          <input type="text" id="metricName" required value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="metricDescription">Description</label>
          <textarea id="metricDescription" placeholder="What does this metric represent?" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="metricFormula">Formula (optional)</label>
          <textarea id="metricFormula" placeholder="e.g., {Deep Work} + {Exercise} * 2" value={formula} onChange={e => setFormula(e.target.value)} />
        </div>
        {isLeaf && (
          <div className="form-group">
            <label htmlFor="metricValue">Value</label>
            <input type="number" id="metricValue" step="any" required value={value} onChange={e => setValue(e.target.value)} />
          </div>
        )}
        <button type="submit" className="btn">Add Metric</button>
      </form>
    </div>
  );
}
