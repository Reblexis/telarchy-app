import type { Metric } from '../types';
import { evaluate, parseFormulaCached } from './formula';

export function evaluateFormula(formula: string, metricsMap: Record<string, Metric>): number | null {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return 0;

  // A metric that exists but has no value yet makes the result unknown (null);
  // a reference to a metric that does not exist evaluates as 0. Grammar and the
  // rest of the contract: docs/formulas.md.
  const lookup = (name: string): number | null => {
    const metric = metricsMap[name];
    if (!metric) return 0;
    if (metric.total === null) return null;
    return metric.total;
  };
  try {
    const result = evaluate(parseFormulaCached(formula), lookup);
    if (result === null) return null;
    if (isNaN(result)) {
      console.error(`evaluateFormula: formula "${formula}" evaluated to NaN`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormula: formula "${formula}" is invalid:`, (e as Error).message);
    return 0;
  }
}

/**
 * Evaluate a formula at a future time point.
 * Leaf nodes (formula = "0") use their market consensus at targetDate.
 * Intermediate nodes are evaluated recursively using their static formulas.
 */
export function evaluateFormulaAtTime(
  formula: string,
  nameToFormula: Record<string, string>,
  consensusMap: Record<string, number>,
  targetDate: string,
  memo: Record<string, number> = {},
): number {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return 0;

  const lookup = (name: string): number => {
    const memoKey = `${name}:${targetDate}`;
    if (memoKey in memo) return memo[memoKey];
    const childFormula = nameToFormula[name];
    let value: number;
    if (!childFormula || childFormula.trim() === '0' || childFormula.trim() === '') {
      value = consensusMap[`${name}:${targetDate}`] ?? 0;
    } else {
      memo[memoKey] = 0; // break potential cycles
      value = evaluateFormulaAtTime(childFormula, nameToFormula, consensusMap, targetDate, memo);
    }
    memo[memoKey] = value;
    return value;
  };
  try {
    const result = evaluate(parseFormulaCached(formula), lookup);
    if (result === null || isNaN(result)) {
      console.error(`evaluateFormulaAtTime: formula "${formula}" evaluated to NaN at ${targetDate}`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormulaAtTime: formula "${formula}" is invalid at ${targetDate}:`, (e as Error).message);
    return 0;
  }
}

export interface FormulaWarning {
  type: 'syntax_error';
  message: string;
}

export function validateFormula(formula: string, metricNames: Set<string>): FormulaWarning[] {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return [];

  const warnings: FormulaWarning[] = [];

  for (const name of extractMetricReferences(formula)) {
    if (!metricNames.has(name)) {
      warnings.push({ type: 'syntax_error', message: `Unknown metric: {${name}}` });
    }
  }

  // Parse against the grammar in docs/formulas.md; the error carries the column.
  // Then evaluate with every reference at 0 to catch results that are NaN for
  // any input (sqrt of a negative literal, log(0) style mistakes).
  try {
    const result = evaluate(parseFormulaCached(formula), () => 0);
    if (result === null || typeof result !== 'number' || isNaN(result)) {
      warnings.push({ type: 'syntax_error', message: 'Formula evaluates to NaN' });
    }
  } catch (e) {
    warnings.push({ type: 'syntax_error', message: `Invalid formula syntax: ${(e as Error).message}` });
  }

  return warnings;
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
  metrics.forEach(m => {
    nameToId[m.name] = m.id;
  });

  const dependents: Record<string, string[]> = {};
  metrics.forEach(m => {
    dependents[m.id] = [];
  });

  metrics.forEach(metric => {
    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const depId = nameToId[depName];
      if (depId && dependents[depId]) dependents[depId].push(metric.id);
    }
  });

  const affected = new Set(changedMetricIds);
  const queue = [...changedMetricIds];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const depId of dependents[currentId] || []) {
      if (!affected.has(depId)) {
        affected.add(depId);
        queue.push(depId);
      }
    }
  }
  return Array.from(affected);
}

export function detectCircularDependency(metricId: string | null, formula: string, allMetrics: Metric[]): boolean {
  const tempMetrics = allMetrics.map(m => (m.id === metricId ? { ...m, formula } : m));
  const nameToId: Record<string, string> = {};
  const idToMetric: Record<string, Metric> = {};
  tempMetrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });

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
  for (const m of tempMetrics) {
    if (hasCycle(m.id)) return true;
  }
  return false;
}

export function topologicalSort(metrics: Metric[]): Metric[] {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => {
    nameToMetric[m.name] = m;
  });

  const sorted: Metric[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(metric: Metric) {
    if (temp.has(metric.id) || visited.has(metric.id)) return;
    temp.add(metric.id);

    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const dep = nameToMetric[depName];
      if (dep) visit(dep);
    }

    temp.delete(metric.id);
    visited.add(metric.id);
    sorted.push(metric);
  }

  metrics.forEach(m => {
    if (!visited.has(m.id)) visit(m);
  });
  return sorted;
}

/**
 * `consensusMap` is accepted and deliberately unused. Callers still build it
 * (services/metrics.ts uses the same map for the projection series), and
 * keeping the parameter documents that market prices are an input this
 * function is not allowed to read: what a metric reads today must never
 * depend on what a market says about it, or a market settles against its own
 * price. Removed the blend 2026-08-30; see the comment in the loop below.
 */
export function recalculateMetrics(metrics: Metric[], _consensusMap: Record<string, number> = {}): Metric[] {
  const sorted = topologicalSort(metrics);
  const nameToMetric: Record<string, Metric> = {};
  sorted.forEach(m => {
    nameToMetric[m.name] = m;
  });

  sorted.forEach(metric => {
    // What a metric reads right now, and nothing else. A leaf reads the value
    // its owner measured; a composite reads its formula over those values.
    //
    // Until 2026-08-30 a metric with time preference blended that reading with
    // the market consensus at each sampled future date, and `total` carried the
    // blend. That number then reached settlement (a metric log stores it as
    // `outlook`, and `metricValueAsOf` preferred `outlook` over `value`), so a
    // market on such a metric settled partly against its own price: traders
    // moved the number they were scored on. The comment above getStatus had
    // already spotted the circularity for callers while settlement kept doing
    // it. Owner, 2026-08-30: "there is no such a thing as outlook, it's just
    // current value, and the predicted value for the given market, and then
    // the market settles on the current value."
    //
    // Time preference still decides WHICH future dates get a market
    // (services/metrics.ts samples the same curve). It no longer decides what
    // a metric reads today, so it cannot reach settlement at all.
    const isLeaf = !metric.formula || metric.formula.trim() === '0';
    metric.total = isLeaf ? metric.value : evaluateFormula(metric.formula, nameToMetric);
    metric.currentTotal = metric.total;
  });

  return metrics;
}

export function calculateMetricDepths(metrics: Metric[]): Record<string, number> {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => {
    nameToMetric[m.name] = m;
  });

  // Build parent→children map (formula references)
  const children: Record<string, string[]> = {};
  const referencedIds = new Set<string>();
  metrics.forEach(metric => {
    const deps: string[] = [];
    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const dep = nameToMetric[depName];
      if (dep) {
        deps.push(dep.id);
        referencedIds.add(dep.id);
      }
    }
    children[metric.id] = deps;
  });

  // Roots = metrics not referenced by any other metric's formula
  const roots = metrics.filter(m => !referencedIds.has(m.id));

  // Multi-root BFS
  const depths: Record<string, number> = {};
  const queue: Array<{ id: string; depth: number }> = [];
  for (const root of roots) {
    depths[root.id] = 0;
    queue.push({ id: root.id, depth: 0 });
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    for (const childId of children[id] || []) {
      const newDepth = depth + 1;
      if (depths[childId] === undefined || newDepth < depths[childId]) {
        depths[childId] = newDepth;
        queue.push({ id: childId, depth: newDepth });
      }
    }
  }

  // Any metric still unassigned (e.g. circular refs) gets depth 0
  metrics.forEach(m => {
    if (depths[m.id] === undefined) depths[m.id] = 0;
  });

  return depths;
}
