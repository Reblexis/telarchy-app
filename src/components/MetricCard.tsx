import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';

function TimePreferenceSparkline({ halfLife }: { halfLife: number }) {
  const W = 60, H = 28;
  const padL = 1, padR = 1, padT = 1, padB = 9;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const axisY = padT + plotH;

  const pts = Array.from({ length: 25 }, (_, i) => {
    const t = (i / 24) * 10;
    const weight = Math.exp((-Math.LN2 / halfLife) * t);
    const x = padL + (i / 24) * plotW;
    const y = padT + (1 - weight) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const axisProps = { stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 1 };
  const labelProps = { fill: 'currentColor', fillOpacity: 0.4, fontSize: 7 };

  return (
    <span title={`Time preference: exponential decay, half-life ${halfLife}y`} style={{ marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <line x1={padL} y1={padT} x2={padL} y2={axisY} {...axisProps} />
        <line x1={padL} y1={axisY} x2={padL + plotW} y2={axisY} {...axisProps} />
        <polyline points={pts} fill="none" stroke="var(--accent-color, #3b82f6)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={padL} y={H - 1} textAnchor="start" {...labelProps}>0</text>
        <text x={padL + plotW} y={H - 1} textAnchor="end" {...labelProps}>10y</text>
      </svg>
    </span>
  );
}

interface MetricCardProps {
  metric: Metric;
  warnings: FormulaWarning[];
  isFocused: boolean;
  onFocus: () => void;
  onGraph: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MetricCard({ metric, warnings, isFocused, onFocus, onGraph, onEdit, onDelete }: MetricCardProps) {
  const isLeaf = !metric.formula || metric.formula === '0';

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
          {isLeaf ? `Value: ${metric.value.toFixed(2)}` : `Total: ${metric.total.toFixed(2)}`}
          {metric.timePreference?.enabled && (
            <TimePreferenceSparkline halfLife={metric.timePreference.halfLife} />
          )}
        </div>
        {!isLeaf && (
          <details style={{ marginTop: '0.5rem' }}>
            <summary>Formula</summary>
            <div>{metric.formula}</div>
          </details>
        )}
        {warnings.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ color: 'var(--error-text)', marginTop: '0.2rem' }}>
                {w.message}
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
