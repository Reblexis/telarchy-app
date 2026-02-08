import { useState, FormEvent } from 'react';

interface AddMetricFormProps {
  onAdd: (name: string, description: string, value: number, formula: string, decay: boolean) => Promise<void>;
}

export function AddMetricForm({ onAdd }: AddMetricFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [formula, setFormula] = useState('0');
  const [decay, setDecay] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onAdd(name, description, Number(value), formula, decay);
    setName('');
    setDescription('');
    setValue('');
    setFormula('0');
    setDecay(false);
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
          <label htmlFor="metricValue">Base Value</label>
          <input type="number" id="metricValue" step="any" required value={value} onChange={e => setValue(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="metricFormula">Formula (optional)</label>
          <textarea id="metricFormula" placeholder="e.g., {Deep Work} + {Exercise} * 2" value={formula} onChange={e => setFormula(e.target.value)} />
        </div>
        <div className="form-group decay-row">
          <label htmlFor="metricDecay">Enable daily decay</label>
          <input type="checkbox" id="metricDecay" checked={decay} onChange={e => setDecay(e.target.checked)} />
        </div>
        <button type="submit" className="btn">Add Metric</button>
      </form>
    </div>
  );
}
