import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';
import { getDependencyChain } from '../lib/metrics-engine';
import { MetricCard } from './MetricCard';
import { FocusBanner } from './FocusBanner';

interface MetricsDashboardProps {
  metrics: Metric[];
  isInspectMode: boolean;
  formulaWarnings: Record<string, FormulaWarning[]>;
  focusedMetricId: string | null;
  onToggleFocus: (id: string) => void;
  onGraph: (metric: Metric) => void;
  onEdit?: (metric: Metric) => void;
  onDelete?: (id: string) => void;
  onValueChange?: (metric: Metric, newValue: number) => void;
}

export function MetricsDashboard({
  metrics, isInspectMode, formulaWarnings, focusedMetricId, onToggleFocus, onGraph, onEdit, onDelete, onValueChange,
}: MetricsDashboardProps) {
  let metricsToRender = metrics;
  let focusedMetric: Metric | undefined;

  if (focusedMetricId) {
    const chain = getDependencyChain(focusedMetricId, metrics);
    metricsToRender = metrics.filter(m => chain.includes(m.id));
    focusedMetric = metrics.find(m => m.id === focusedMetricId);
  }

  const groupedByDepth: Record<number, Metric[]> = {};
  metricsToRender.forEach(metric => {
    const depth = metric.depth ?? 0;
    if (!groupedByDepth[depth]) groupedByDepth[depth] = [];
    groupedByDepth[depth].push(metric);
  });

  const depths = Object.keys(groupedByDepth).map(Number).sort((a, b) => a - b);

  return (
    <div className="section">
      <h2>Metrics Dashboard</h2>
      <div className="metrics-grid" id="metricsGrid">
        {focusedMetric && (
          <FocusBanner metric={focusedMetric} onExit={() => onToggleFocus(focusedMetricId!)} />
        )}
        {depths.map(depth => (
          <div className="depth-group" key={depth} style={{ marginBottom: '2rem' }}>
            {depths.length > 1 && (
              <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.5rem', fontWeight: 500 }}>
                Level {depth}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {groupedByDepth[depth].map(metric => (
                <MetricCard
                  key={metric.id}
                  metric={metric}
                  isInspectMode={isInspectMode}
                  warnings={formulaWarnings[metric.id] || []}
                  isFocused={focusedMetricId === metric.id}
                  onFocus={() => onToggleFocus(metric.id)}
                  onGraph={() => onGraph(metric)}
                  onEdit={onEdit ? () => onEdit(metric) : undefined}
                  onDelete={onDelete ? () => onDelete(metric.id) : undefined}
                  onValueChange={onValueChange ? (v) => onValueChange(metric, v) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
