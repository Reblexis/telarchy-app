import { useRef, useState } from 'react';
import type { Metric } from '../types';
import type { FormulaWarning } from '../lib/metrics-engine';
import { getDependencyChain } from '../lib/metrics-engine';
import { MetricCard } from './MetricCard';
import { FocusBanner } from './FocusBanner';
import { AddMetricGhostCard } from './AddMetricGhostCard';

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
  onAddMetric?: (name: string, description: string, value: number, formula: string, marketRangeMax?: number) => Promise<void>;
  onReorder?: (orderedIdsAtDepth: string[]) => Promise<void>;
}

interface DragState {
  id: string;
  depth: number;
}

export function MetricsDashboard({
  metrics, isInspectMode, formulaWarnings, focusedMetricId, onToggleFocus, onGraph, onEdit, onDelete, onValueChange, onAddMetric, onReorder,
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

  // Reorder only makes sense over the full, unfiltered list. When a metric is
  // focused we're rendering a dependency-chain subset, so we hide the affordance.
  const canDrag = !!onReorder && !isInspectMode && !focusedMetricId;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  // Drag should only fire when the pointerdown lands on a non-interactive part
  // of the card (so text-selection inside the inline value input and button
  // clicks still work). We can't gate via React state because the dragstart
  // event reaches the DOM before React re-renders draggable=true, so we stash
  // the pointerdown target in a ref and cancel dragstart when it's interactive.
  const lastDownInteractive = useRef(false);

  const handleDrop = async (toId: string, before: boolean) => {
    if (!drag || !onReorder) { setDrag(null); setDropTarget(null); return; }
    const peers = groupedByDepth[drag.depth] ?? [];
    const fromIdx = peers.findIndex(m => m.id === drag.id);
    let toIdx = peers.findIndex(m => m.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
      setDrag(null); setDropTarget(null); return;
    }
    const ids = peers.map(m => m.id);
    const [moved] = ids.splice(fromIdx, 1);
    if (toIdx > fromIdx) toIdx -= 1;
    const insertAt = before ? toIdx : toIdx + 1;
    ids.splice(insertAt, 0, moved);
    setDrag(null);
    setDropTarget(null);
    try { await onReorder(ids); } catch (e) { console.error('reorder failed:', e); }
  };

  return (
    <>
      <div className="section-header">
        <h2>Metrics Dashboard</h2>
        <p className="section-subtitle">
          Every tracked metric and its formula-derived descendants. Expand a card to see its history, edit the formula, or jump to its markets.
        </p>
      </div>
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
              {groupedByDepth[depth].map(metric => {
                const isBeingDragged = drag?.id === metric.id;
                const isDropTarget = dropTarget?.id === metric.id && drag?.depth === depth && drag?.id !== metric.id;
                const cardWrapperStyle: React.CSSProperties = {
                  position: 'relative',
                  opacity: isBeingDragged ? 0.4 : 1,
                  cursor: canDrag ? 'grab' : undefined,
                  transition: 'opacity 0.15s',
                };
                return (
                  <div
                    key={metric.id}
                    draggable={canDrag}
                    onPointerDown={canDrag ? (e) => {
                      const t = e.target as HTMLElement;
                      lastDownInteractive.current = !!t.closest('input, textarea, select, button, a, [contenteditable="true"]');
                    } : undefined}
                    onDragStart={canDrag ? (e) => {
                      if (lastDownInteractive.current) { e.preventDefault(); return; }
                      setDrag({ id: metric.id, depth });
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox needs setData to start a drag.
                      e.dataTransfer.setData('text/plain', metric.id);
                    } : undefined}
                    onDragEnd={canDrag ? () => { setDrag(null); setDropTarget(null); } : undefined}
                    onDragOver={canDrag && drag && drag.depth === depth && drag.id !== metric.id ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const before = e.clientX < rect.left + rect.width / 2;
                      setDropTarget(prev => prev?.id === metric.id && prev.before === before ? prev : { id: metric.id, before });
                    } : undefined}
                    onDragLeave={canDrag ? (e) => {
                      const next = e.relatedTarget as Node | null;
                      if (!next || !(e.currentTarget as HTMLDivElement).contains(next)) {
                        setDropTarget(prev => prev?.id === metric.id ? null : prev);
                      }
                    } : undefined}
                    onDrop={canDrag && drag && drag.depth === depth ? (e) => {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      const before = e.clientX < rect.left + rect.width / 2;
                      void handleDrop(metric.id, before);
                    } : undefined}
                    style={cardWrapperStyle}
                  >
                    {isDropTarget && (
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          width: 3,
                          background: 'var(--accent, #6366f1)',
                          borderRadius: 2,
                          [dropTarget.before ? 'left' : 'right']: -8,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    <MetricCard
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
                  </div>
                );
              })}
              {depth === depths[depths.length - 1] && onAddMetric && (
                <AddMetricGhostCard onAdd={onAddMetric} />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
