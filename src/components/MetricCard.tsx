import { useMemo, useState, useRef } from 'react';
import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';
import { MetricsTimeChart } from './charts/MetricsTimeChart';
import { buildPointsFromTimeSeries } from '../lib/metrics-chart-model';

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
  isInspectMode: boolean;
  warnings: FormulaWarning[];
  isFocused: boolean;
  onFocus: () => void;
  onGraph: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onValueChange?: (newValue: number) => void;
}

export function MetricCard({ metric, isInspectMode, warnings, isFocused, onFocus, onGraph, onEdit, onDelete, onValueChange }: MetricCardProps) {
  const isLeaf = !metric.formula || metric.formula.trim() === '0';
  const hasTP = metric.timePreference?.enabled === true;
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValueStr, setEditValueStr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const points = useMemo(
    () => (metric.timeSeries ? buildPointsFromTimeSeries(metric.timeSeries) : []),
    [metric.timeSeries],
  );
  const conditionalPoints = useMemo(
    () => (metric.conditionalTimeSeries ? buildPointsFromTimeSeries(metric.conditionalTimeSeries) : undefined),
    [metric.conditionalTimeSeries],
  );

  return (
    <div className="metric-card">
      <div className="metric-info">
        <div className="metric-name">
          {metric.name}
          {isLeaf && (
            <span className="leaf-badge">leaf</span>
          )}
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
          {isLeaf ? (
            isEditingValue ? (
              <span>
                Now:{' '}
                <input
                  ref={inputRef}
                  type="number"
                  step="any"
                  value={editValueStr}
                  onChange={e => setEditValueStr(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = parseFloat(editValueStr);
                      if (!isNaN(v) && onValueChange) onValueChange(v);
                      setIsEditingValue(false);
                    } else if (e.key === 'Escape') {
                      setIsEditingValue(false);
                    }
                  }}
                  onBlur={() => {
                    const v = parseFloat(editValueStr);
                    if (!isNaN(v) && onValueChange) onValueChange(v);
                    setIsEditingValue(false);
                  }}
                  style={{ width: '6rem', fontSize: 'inherit', padding: '0 0.25rem' }}
                  autoFocus
                />
              </span>
            ) : (
              <span
                onClick={onValueChange ? () => { setEditValueStr(String(metric.value)); setIsEditingValue(true); } : undefined}
                style={onValueChange ? { cursor: 'text', borderBottom: '1px dashed currentColor' } : undefined}
                title={onValueChange ? 'Update your current self-report' : undefined}
              >
                Now: {metric.value.toFixed(2)}
              </span>
            )
          ) : hasTP
              ? (metric.total === null ? 'Outlook: -' : `Outlook: ${metric.total.toFixed(2)}`)
              : (metric.total === null ? 'Now: -' : `Now: ${metric.total.toFixed(2)}`)
          }
          {isLeaf && hasTP && (
            <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>
              {metric.total === null ? 'Outlook: -' : `Outlook: ${metric.total.toFixed(2)}`}
            </span>
          )}
          {!isLeaf && metric.baselineTotal != null && metric.total !== null && (() => {
            const delta = metric.total - metric.baselineTotal;
            if (Math.abs(delta) < 0.005) return null;
            return (
              <span style={{ marginLeft: '0.5rem', color: delta > 0 ? '#22c55e' : '#ef4444', fontSize: '0.85em', fontWeight: 600 }}>
                {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(2)}
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>
                  (was {metric.baselineTotal.toFixed(2)})
                </span>
              </span>
            );
          })()}
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
        {metric.missingMarkets?.length ? (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}
            title={`Awaiting first trade on: ${metric.missingMarkets.join(', ')}`}>
            No forecast chart - awaiting {metric.missingMarkets.length === 1 ? metric.missingMarkets[0] : `${metric.missingMarkets.length} markets`}
          </div>
        ) : metric.timeSeries && metric.timeSeries.length > 0 && (
          <div style={{ marginTop: '0.75rem', height: 220 }}>
            <MetricsTimeChart
              points={points}
              conditionalPoints={conditionalPoints}
              mode={isInspectMode ? 'inspect' : 'normal'}
              variant="inline"
              rangeMin={metric.marketRangeMax !== undefined ? 0 : undefined}
              rangeMax={metric.marketRangeMax}
            />
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
