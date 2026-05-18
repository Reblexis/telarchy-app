import { useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';
import { MetricsTimeChart } from './charts/MetricsTimeChart';
import { buildPointsFromTimeSeries } from '../lib/metrics-chart-model';

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
  const navigate = useNavigate();
  const isLeaf = !metric.formula || metric.formula.trim() === '0';
  const hasTP = metric.timePreference?.enabled === true;
  const overlayHalfLife = hasTP ? metric.timePreference!.halfLife : metric.inheritedHalfLife;
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValueStr, setEditValueStr] = useState('');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against onBlur firing a second onValueChange right after Enter
  // (the input unmounts on Enter, which also induces a blur event).
  const submittedRef = useRef(false);
  const points = useMemo(
    () => (metric.timeSeries ? buildPointsFromTimeSeries(metric.timeSeries) : []),
    [metric.timeSeries],
  );
  const conditionalPoints = useMemo(
    () => (metric.conditionalTimeSeries ? buildPointsFromTimeSeries(metric.conditionalTimeSeries) : undefined),
    [metric.conditionalTimeSeries],
  );

  return (
    <div className="metric-card" id={`metric-${metric.id}`}>
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
          <div
            className="metric-stats"
            onClick={() => setIsDescriptionExpanded(v => !v)}
            title={isDescriptionExpanded ? 'Click to collapse' : metric.description}
            style={{
              marginBottom: '0.25rem',
              fontStyle: 'italic',
              cursor: 'pointer',
              ...(isDescriptionExpanded
                ? {}
                : {
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }),
            }}
          >
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
                      if (!isNaN(v) && onValueChange && v !== metric.value) onValueChange(v);
                      submittedRef.current = true;
                      setIsEditingValue(false);
                    } else if (e.key === 'Escape') {
                      submittedRef.current = true;
                      setIsEditingValue(false);
                    }
                  }}
                  onBlur={() => {
                    if (submittedRef.current) { submittedRef.current = false; return; }
                    const v = parseFloat(editValueStr);
                    if (!isNaN(v) && onValueChange && v !== metric.value) onValueChange(v);
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
          {hasTP && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}
              title={`Time preference: half-life ${metric.timePreference!.halfLife}y`}>
              TP {metric.timePreference!.halfLife}y
            </span>
          )}
          {isLeaf && (
            <Link
              to={`/markets?q=${encodeURIComponent(metric.name)}`}
              style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', textDecoration: 'underline' }}
              title="See the prediction markets forecasting this metric"
            >
              Markets →
            </Link>
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
        {isLeaf && !hasTP && !metric.inheritedHalfLife && (
          <div
            style={{
              marginTop: '0.5rem', fontSize: '0.75rem',
              color: 'var(--accent-text)',
              cursor: onEdit ? 'pointer' : 'default',
            }}
            onClick={onEdit}
            role={onEdit ? 'button' : undefined}
            title="Markets only spawn for metrics with a time preference (or for leaves whose ancestor has one). Click to edit."
          >
            No forecasts - enable Time Preference to spawn prediction markets.
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
              halfLifeYears={overlayHalfLife}
              onPointClick={(point) => {
                const params = new URLSearchParams();
                if (isLeaf) params.set('q', metric.name);
                params.set('target', point.label);
                navigate(`/markets?${params.toString()}`);
              }}
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
