// Frontend tree helpers over the metric dependency graph. The heavy lifting
// (formula parsing, leaf BFS) lives in the shared metrics-engine barrel; this
// module just adds id-based wrappers the UI needs.
import { getLeafDescendantNames } from './metrics-engine';
import type { Metric } from '../types';

/**
 * A metric is composite (derived) when it has a formula referencing children.
 * A leaf has no formula (stored as '' or '0'). Mirrors the backend leaf check
 * used by getLeafDescendantNames so the two never disagree.
 */
export function isCompositeMetric(metric: Pick<Metric, 'formula'>): boolean {
  const f = (metric.formula ?? '').trim();
  return f !== '' && f !== '0';
}

/**
 * Transitive leaf-descendant metric ids of `metricId`. Empty for a leaf (or an
 * unknown id). Markets only exist on leaves, so this is the exact set of metric
 * ids whose markets sit "under" a composite metric.
 */
export function getLeafDescendantIds(metricId: string, metrics: Metric[]): Set<string> {
  const start = metrics.find(m => m.id === metricId);
  if (!start) return new Set();

  const nameToFormula: Record<string, string> = {};
  const nameToId: Record<string, string> = {};
  for (const m of metrics) {
    nameToFormula[m.name] = m.formula || '0';
    nameToId[m.name] = m.id;
  }

  const ids = new Set<string>();
  for (const name of getLeafDescendantNames(start.name, nameToFormula)) {
    const id = nameToId[name];
    if (id) ids.add(id);
  }
  return ids;
}
