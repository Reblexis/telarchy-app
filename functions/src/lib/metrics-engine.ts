import type { Metric } from '../types';
import { toAbsoluteDate, isValidDateFormat, isRelativeDate } from './date-utils';

const CONSENSUS_RE = /consensus\("([^"]+)",\s*"([^"]+)"\)/g;

export function evaluateFormula(
  formula: string,
  metricsMap: Record<string, Metric>,
  consensusMap: Record<string, number> = {},
): number {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return 0;

  let expression = formula;

  // Replace consensus("MetricName", "YYYY-MM-DD" or "+10d") with looked-up values
  expression = expression.replace(CONSENSUS_RE, (_match, name: string, date: string) => {
    const absoluteDate = toAbsoluteDate(date);
    const key = `${name}:${absoluteDate}`;
    return String(consensusMap[key] ?? 0);
  });

  // Replace {MetricName} references
  const metricRefs = expression.match(/\{([^}]+)\}/g);
  if (metricRefs) {
    for (const ref of metricRefs) {
      const metricName = ref.slice(1, -1).trim();
      const metric = metricsMap[metricName];
      expression = expression.replace(ref, metric ? String(metric.total) : '0');
    }
  }

  expression = expression.replace(/sqrt\(/g, 'Math.sqrt(');
  expression = expression.replace(/abs\(/g, 'Math.abs(');
  expression = expression.replace(/min\(/g, 'Math.min(');
  expression = expression.replace(/max\(/g, 'Math.max(');
  expression = expression.replace(/pow\(/g, 'Math.pow(');

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  try {
    const result = Function('clamp', 'return (' + expression + ')')(clamp);
    return isNaN(result) ? 0 : result;
  } catch {
    return 0;
  }
}

export function extractConsensusReferences(formula: string): Array<{ name: string; date: string; isRelative: boolean }> {
  if (!formula) return [];
  const refs: Array<{ name: string; date: string; isRelative: boolean }> = [];
  let match;
  const re = new RegExp(CONSENSUS_RE.source, 'g');
  while ((match = re.exec(formula)) !== null) {
    const date = match[2];
    const isRel = isRelativeDate(date);
    const isAbs = isValidDateFormat(date);
    
    if (isAbs || isRel) {
      refs.push({ name: match[1], date, isRelative: isRel });
    }
  }
  return refs;
}

export function extractMetricReferences(formula: string): string[] {
  if (!formula) return [];
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).trim());
}

/** BFS through {MetricName} references to find all transitive formula dependencies. */
export function getTransitiveDependencyNames(metricName: string, nameToFormula: Record<string, string>): string[] {
  const deps = new Set<string>();
  const queue = [metricName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const formula = nameToFormula[current];
    if (!formula) continue;

    for (const depName of extractMetricReferences(formula)) {
      if (!deps.has(depName)) {
        deps.add(depName);
        queue.push(depName);
      }
    }
  }

  return Array.from(deps);
}

export function getAffectedMetrics(changedMetricIds: string[], metrics: Metric[]): string[] {
  const nameToId: Record<string, string> = {};
  metrics.forEach(m => { nameToId[m.name] = m.id; });

  const dependents: Record<string, string[]> = {};
  metrics.forEach(m => { dependents[m.id] = []; });

  metrics.forEach(metric => {
    const metricRefs = extractMetricReferences(metric.formula || '0');
    const consensusRefs = extractConsensusReferences(metric.formula || '0');
    
    // Handle {MetricName} references
    metricRefs.forEach(depName => {
      const depId = nameToId[depName];
      if (depId && dependents[depId]) dependents[depId].push(metric.id);
    });
    
    // Handle consensus("MetricName", date) references
    consensusRefs.forEach(({ name }) => {
      const depId = nameToId[name];
      if (depId && dependents[depId]) dependents[depId].push(metric.id);
    });
  });

  const affected = new Set(changedMetricIds);
  const queue = [...changedMetricIds];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const depId of (dependents[currentId] || [])) {
      if (!affected.has(depId)) {
        affected.add(depId);
        queue.push(depId);
      }
    }
  }
  return Array.from(affected);
}

export function detectCircularDependency(metricId: string | null, formula: string, allMetrics: Metric[]): boolean {
  const tempMetrics = allMetrics.map(m => m.id === metricId ? { ...m, formula } : m);
  const nameToId: Record<string, string> = {};
  const idToMetric: Record<string, Metric> = {};
  tempMetrics.forEach(m => { nameToId[m.name] = m.id; idToMetric[m.id] = m; });

  if (metricId) {
    for (const depName of extractMetricReferences(formula)) {
      if (nameToId[depName] === metricId) return true;
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(currentId: string): boolean {
    if (recStack.has(currentId)) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    recStack.add(currentId);
    const current = idToMetric[currentId];
    if (current && current.formula) {
      for (const depName of extractMetricReferences(current.formula)) {
        const depId = nameToId[depName];
        if (depId && hasCycle(depId)) return true;
      }
    }
    recStack.delete(currentId);
    return false;
  }

  if (metricId) return hasCycle(metricId);
  for (const m of tempMetrics) { if (hasCycle(m.id)) return true; }
  return false;
}

export function topologicalSort(metrics: Metric[]): Metric[] {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => { nameToMetric[m.name] = m; });

  const sorted: Metric[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(metric: Metric) {
    if (temp.has(metric.id) || visited.has(metric.id)) return;
    temp.add(metric.id);
    
    const metricRefs = extractMetricReferences(metric.formula || '0');
    const consensusRefs = extractConsensusReferences(metric.formula || '0');
    
    // Handle {MetricName} references
    for (const depName of metricRefs) {
      const dep = nameToMetric[depName];
      if (dep) visit(dep);
    }
    
    // Handle consensus("MetricName", date) references
    for (const { name } of consensusRefs) {
      const dep = nameToMetric[name];
      if (dep) visit(dep);
    }
    
    temp.delete(metric.id);
    visited.add(metric.id);
    sorted.push(metric);
  }

  metrics.forEach(m => { if (!visited.has(m.id)) visit(m); });
  return sorted;
}

export function recalculateMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  const sorted = topologicalSort(metrics);
  const nameToMetric: Record<string, Metric> = {};
  sorted.forEach(m => { nameToMetric[m.name] = m; });
  sorted.forEach(metric => {
    metric.total = metric.value + evaluateFormula(metric.formula || '0', nameToMetric, consensusMap);
  });
  return metrics;
}

export const UNASSIGNED_DEPTH = 9999;

export function calculateMetricDepths(metrics: Metric[]): Record<string, number> {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => { nameToMetric[m.name] = m; });

  // Build children map: for each metric, which metrics does it reference
  const children: Record<string, string[]> = {};
  metrics.forEach(metric => {
    const metricRefs = extractMetricReferences(metric.formula || '0');
    const consensusRefs = extractConsensusReferences(metric.formula || '0');
    
    const deps: string[] = [];
    for (const depName of metricRefs) {
      const dep = nameToMetric[depName];
      if (dep) deps.push(dep.id);
    }
    for (const { name } of consensusRefs) {
      const dep = nameToMetric[name];
      if (dep) deps.push(dep.id);
    }
    children[metric.id] = deps;
  });

  // BFS from Utility to assign levels
  const depths: Record<string, number> = {};
  const utility = metrics.find(m => m.name === 'Utility');
  
  if (utility) {
    const queue: Array<{ id: string; depth: number }> = [{ id: utility.id, depth: 0 }];
    depths[utility.id] = 0;
    
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      
      for (const childId of (children[id] || [])) {
        const newDepth = depth + 1;
        if (depths[childId] === undefined || newDepth < depths[childId]) {
          depths[childId] = newDepth;
          queue.push({ id: childId, depth: newDepth });
        }
      }
    }
  }

  // Anything not reachable from Utility is unassigned
  metrics.forEach(metric => {
    if (depths[metric.id] === undefined) {
      depths[metric.id] = UNASSIGNED_DEPTH;
    }
  });

  return depths;
}

export function calculateXP(metrics: Metric[]): number {
  const utilityMetric = metrics.find(m => m.name === 'Utility');
  return utilityMetric ? utilityMetric.total : 0;
}

export function calculateRank(xp: number): string {
  if (xp >= 900) return 'S';
  if (xp >= 800) return 'A';
  if (xp >= 700) return 'B';
  if (xp >= 600) return 'C';
  if (xp >= 500) return 'D';
  if (xp >= 400) return 'E';
  return '-';
}

export function calculateDaysPassed(lastDate: string, currentDate: Date): number {
  const last = new Date(lastDate);
  const current = new Date(currentDate);
  last.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  return Math.floor((current.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}
