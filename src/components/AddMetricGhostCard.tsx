import { useState, useRef, useEffect, FormEvent } from 'react';

interface AddMetricGhostCardProps {
  onAdd: (name: string, description: string, value: number, formula: string, marketRangeMax?: number) => Promise<void>;
  autoFocus?: boolean;
}

export function AddMetricGhostCard({ onAdd, autoFocus }: AddMetricGhostCardProps) {
  const [isExpanded, setIsExpanded] = useState(!!autoFocus);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formula, setFormula] = useState('');
  const [value, setValue] = useState('');
  const [marketRangeMax, setMarketRangeMax] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const isLeaf = !formula || formula.trim() === '0';

  useEffect(() => {
    if (isExpanded && nameRef.current) {
      nameRef.current.focus();
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (cardRef.current && cardRef.current.contains(target)) return;
      // Don't collapse when the user clicks inside the welcome tour overlay;
      // the tour is actively coaching this form.
      if (target instanceof Element && target.closest('.tour-coach, .tour-overlay')) return;
      collapse();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isExpanded]);

  const collapse = () => {
    if (autoFocus) return;
    setIsExpanded(false);
    setShowAdvanced(false);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setFormula('');
    setValue('');
    setMarketRangeMax('');
    setError('');
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const rmx = Math.max(1, Number(marketRangeMax) || 1000);
      await onAdd(name, description, isLeaf ? Number(value) || 0 : 0, formula || '0', rmx);
      resetForm();
      setShowAdvanced(false);
      if (!autoFocus) setIsExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add metric');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !showAdvanced && name.trim()) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!isExpanded) {
    return (
      <div
        className="metric-card add-metric-ghost"
        data-tour-id="metric-add-ghost"
        onClick={() => setIsExpanded(true)}
      >
        <span className="ghost-icon">+</span>
        <span className="ghost-label">Add metric</span>
      </div>
    );
  }

  return (
    <div
      className="metric-card add-metric-ghost expanded"
      data-tour-id="metric-add-ghost"
      ref={cardRef}
      onKeyDown={handleKeyDown}
    >
      <form onSubmit={handleSubmit}>
        <input
          ref={nameRef}
          type="text"
          className="metric-name-input"
          data-tour-id="metric-form-name"
          placeholder="Metric name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleNameKeyDown}
          required
        />

        <button
          type="button"
          className="add-metric-toggle"
          data-tour-id="metric-form-more-options"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '- Less options' : '+ More options'}
        </button>

        {showAdvanced && (
          <div className="add-metric-advanced">
            <div className="form-group">
              <label htmlFor="ghostDescription">Description</label>
              <textarea
                id="ghostDescription"
                placeholder="What does this metric represent?"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="ghostFormula">Formula</label>
              <input
                type="text"
                id="ghostFormula"
                placeholder="e.g. {Deep Work} + {Exercise} * 2"
                value={formula}
                onChange={e => setFormula(e.target.value)}
              />
            </div>
            {isLeaf && (
              <div className="form-group">
                <label htmlFor="ghostValue">Value</label>
                <input
                  type="number"
                  id="ghostValue"
                  step="any"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                />
              </div>
            )}
            <div className="form-group">
              <label htmlFor="ghostMarketMax">Max expected value</label>
              <input
                type="number"
                id="ghostMarketMax"
                step="any"
                min="1"
                placeholder="1000"
                value={marketRangeMax}
                onChange={e => setMarketRangeMax(e.target.value)}
              />
            </div>
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--error-text)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</div>
        )}

        <div className="add-metric-actions">
          {!autoFocus && (
            <button type="button" className="add-metric-cancel" onClick={collapse}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn" disabled={submitting || !name.trim()}>
            {submitting ? 'Adding...' : 'Add Metric'}
          </button>
        </div>
      </form>
    </div>
  );
}
