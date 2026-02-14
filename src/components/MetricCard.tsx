import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';

interface MetricCardProps {
  metric: Metric;
  warnings: FormulaWarning[];
  isFocused: boolean;
  onFocus: () => void;
  onGraph: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreateMarket: (metricName: string, targetDate: string) => void;
}

export function MetricCard({ metric, warnings, isFocused, onFocus, onGraph, onEdit, onDelete, onCreateMarket }: MetricCardProps) {
  const hasFormula = metric.formula && metric.formula !== '0';
  const formulaResult = metric.total - metric.value;

  return (
    <div className="metric-card">
      <div className="metric-info">
        <div className="metric-name">
          {metric.name}
          {warnings.length > 0 && (
            <span title={warnings.map(w => w.message).join('\n')} style={{ marginLeft: '0.5rem', color: 'var(--error-text)', cursor: 'help' }}>!</span>
          )}
        </div>
        {metric.description && (
          <div className="metric-stats" style={{ marginBottom: '0.25rem', fontStyle: 'italic' }}>
            {metric.description}
          </div>
        )}
        <div className="metric-stats">
          Base: {metric.value.toFixed(2)} | Total: {metric.total.toFixed(2)}
        </div>
        {hasFormula && (
          <details style={{ marginTop: '0.5rem' }}>
            <summary>Formula (+{formulaResult.toFixed(2)})</summary>
            <div>{metric.formula}</div>
          </details>
        )}
        {warnings.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ color: 'var(--error-text)', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                <span>{w.message}</span>
                {w.type === 'missing_market' && w.metricName && w.targetDate && (
                  <button
                    className="btn-small"
                    style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem' }}
                    onClick={() => onCreateMarket(w.metricName!, w.targetDate!)}
                  >
                    Create
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="metric-actions">
        <button className={`btn-small btn-focus ${isFocused ? 'active' : ''}`} onClick={onFocus} title="Focus on this metric">
          Zoom
        </button>
        <button className="btn-small" onClick={onGraph}>Graph</button>
        <button className="btn-small" onClick={onEdit}>Edit</button>
        <button className="btn-small btn-delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
