import type { Metric } from '../types';
import { sampleTimePoints, WEIGHT_T0 } from './time-preference';

export function evaluateFormula(
  formula: string,
  metricsMap: Record<string, Metric>,
): number | null {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return 0;

  let expression = formula;

  const metricRefs = expression.match(/\{([^}]+)\}/g);
  if (metricRefs) {
    for (const ref of metricRefs) {
      const metricName = ref.slice(1, -1).trim();
      const metric = metricsMap[metricName];
      if (metric?.total === null) return null;
      expression = expression.replace(ref, metric ? String(metric.total) : '0');
    }
  }

  expression = expression.replace(/sqrt\(/g, 'Math.sqrt(');
  expression = expression.replace(/abs\(/g, 'Math.abs(');
  expression = expression.replace(/log10\(/g, 'Math.log10(');
  expression = expression.replace(/log\(/g, 'Math.log(');
  expression = expression.replace(/min\(/g, 'Math.min(');
  expression = expression.replace(/max\(/g, 'Math.max(');
  expression = expression.replace(/pow\(/g, 'Math.pow(');

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  try {
    const result = Function('clamp', 'return (' + expression + ')')(clamp);
    if (isNaN(result)) {
      console.error(`evaluateFormula: formula "${formula}" evaluated to NaN (expanded: "${expression}")`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormula: formula "${formula}" threw (expanded: "${expression}"):`, e);
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

  let expression = formula;

  const metricRefs = expression.match(/\{([^}]+)\}/g);
  if (metricRefs) {
    for (const ref of metricRefs) {
      const name = ref.slice(1, -1).trim();
      const memoKey = `${name}:${targetDate}`;
      let value: number;
      if (memoKey in memo) {
        value = memo[memoKey];
      } else {
        const childFormula = nameToFormula[name];
        if (!childFormula || childFormula.trim() === '0' || childFormula.trim() === '') {
          value = consensusMap[`${name}:${targetDate}`] ?? 0;
        } else {
          memo[memoKey] = 0; // break potential cycles
          value = evaluateFormulaAtTime(childFormula, nameToFormula, consensusMap, targetDate, memo);
        }
        memo[memoKey] = value;
      }
      expression = expression.replace(ref, String(value));
    }
  }

  expression = expression.replace(/sqrt\(/g, 'Math.sqrt(');
  expression = expression.replace(/abs\(/g, 'Math.abs(');
  expression = expression.replace(/log10\(/g, 'Math.log10(');
  expression = expression.replace(/log\(/g, 'Math.log(');
  expression = expression.replace(/min\(/g, 'Math.min(');
  expression = expression.replace(/max\(/g, 'Math.max(');
  expression = expression.replace(/pow\(/g, 'Math.pow(');

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  try {
    const result = Function('clamp', 'return (' + expression + ')')(clamp);
    if (isNaN(result)) {
      console.error(`evaluateFormulaAtTime: formula "${formula}" evaluated to NaN at ${targetDate} (expanded: "${expression}")`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormulaAtTime: formula "${formula}" threw at ${targetDate} (expanded: "${expression}"):`, e);
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

  const stripCalls = (s: string): string => {
    const fns = ['min', 'max', 'pow', 'sqrt', 'abs', 'clamp', 'log10', 'log'];
    let r = s;
    for (const fn of fns) {
      const re = new RegExp(fn + '\\s*\\(', 'g');
      const m = re.exec(r);
      if (m) {
        let d = 1;
        let i = m.index + m[0].length;
        while (i < r.length && d > 0) {
          if (r[i] === '(') d++;
          else if (r[i] === ')') d--;
          i++;
        }
        r = r.slice(0, m.index) + '0' + r.slice(i);
        return stripCalls(r);
      }
    }
    return r;
  };
  if (stripCalls(formula).includes(',')) {
    warnings.push({ type: 'syntax_error', message: 'Comma in formula discards left side (use + to add terms)' });
  }

  let testExpr = formula;
  testExpr = testExpr.replace(/\{([^}]+)\}/g, '0');
  testExpr = testExpr.replace(/sqrt\(/g, 'Math.sqrt(');
  testExpr = testExpr.replace(/abs\(/g, 'Math.abs(');
  testExpr = testExpr.replace(/log10\(/g, 'Math.log10(');
  testExpr = testExpr.replace(/log\(/g, 'Math.log(');
  testExpr = testExpr.replace(/min\(/g, 'Math.min(');
  testExpr = testExpr.replace(/max\(/g, 'Math.max(');
  testExpr = testExpr.replace(/pow\(/g, 'Math.pow(');
  const clampFn = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  try {
    const result = Function('clamp', 'return (' + testExpr + ')')(clampFn);
    if (typeof result !== 'number' || isNaN(result)) {
      warnings.push({ type: 'syntax_error', message: 'Formula evaluates to NaN' });
    }
  } catch (e) {
    warnings.push({ type: 'syntax_error', message: `Invalid formula syntax: ${(e as Error).message}` });
  }

  return warnings;
}

export function getDependencyChain(metricId: string, metrics: Metric[]): string[] {
  const nameToId: Record<string, string> = {};
  const idToMetric: Record<string, Metric> = {};
  metrics.forEach(m => { nameToId[m.name] = m.id; idToMetric[m.id] = m; });

  const chain = new Set([metricId]);
  getAffectedMetrics([metricId], metrics).forEach(id => chain.add(id));

  const visited = new Set<string>();
  function addParents(currentId: string) {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    const metric = idToMetric[currentId];
    if (metric && metric.formula) {
      for (const depName of extractMetricReferences(metric.formula)) {
        const depId = nameToId[depName];
        if (depId) { chain.add(depId); addParents(depId); }
      }
    }
  }
  addParents(metricId);
  return Array.from(chain);
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
    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const depId = nameToId[depName];
      if (depId && dependents[depId]) dependents[depId].push(metric.id);
    }
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

    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const dep = nameToMetric[depName];
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

  const nameToFormula: Record<string, string> = {};
  sorted.forEach(m => { nameToFormula[m.name] = m.formula || '0'; });

  sorted.forEach(metric => {
    const isLeaf = !metric.formula || metric.formula.trim() === '0';
    if (isLeaf && metric.timePreference?.enabled) {
      // Leaf with TP: blend current value with market consensus at future dates
      metric.currentTotal = metric.value;
      if (metric.missingMarkets?.length) {
        metric.total = null;
      } else {
        const { halfLife } = metric.timePreference;
        let weightedSum = WEIGHT_T0 * metric.value;
        let totalWeight = WEIGHT_T0;
        for (const { date, weight } of sampleTimePoints(halfLife)) {
          const consensusAtT = consensusMap[`${metric.name}:${date}`] ?? metric.value;
          weightedSum += weight * consensusAtT;
          totalWeight += weight;
        }
        metric.total = totalWeight > 0 ? weightedSum / totalWeight : metric.value;
      }
    } else if (isLeaf) {
      metric.total = metric.value;
      metric.currentTotal = metric.value;
    } else if (metric.timePreference?.enabled) {
      if (metric.missingMarkets?.length) {
        metric.total = null;
        metric.currentTotal = null;
      } else {
        const { halfLife } = metric.timePreference;
        const formula = metric.formula;

        const formulaAt0 = evaluateFormula(formula, nameToMetric);
        metric.currentTotal = formulaAt0;
        if (formulaAt0 === null) { metric.total = null; }
        else {
          let weightedSum = WEIGHT_T0 * formulaAt0;
          let totalWeight = WEIGHT_T0;

          const memo: Record<string, number> = {};
          for (const { date, weight } of sampleTimePoints(halfLife)) {
            const formulaAtT = evaluateFormulaAtTime(formula, nameToFormula, consensusMap, date, memo);
            weightedSum += weight * formulaAtT;
            totalWeight += weight;
          }

          metric.total = totalWeight > 0 ? weightedSum / totalWeight : formulaAt0;
        }
      }
    } else {
      metric.total = evaluateFormula(metric.formula, nameToMetric);
      metric.currentTotal = metric.total;
    }
  });

  return metrics;
}

export function calculateMetricDepths(metrics: Metric[]): Record<string, number> {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => { nameToMetric[m.name] = m; });

  // Build parent→children map (formula references)
  const children: Record<string, string[]> = {};
  const referencedIds = new Set<string>();
  metrics.forEach(metric => {
    const deps: string[] = [];
    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const dep = nameToMetric[depName];
      if (dep) { deps.push(dep.id); referencedIds.add(dep.id); }
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
    for (const childId of (children[id] || [])) {
      const newDepth = depth + 1;
      if (depths[childId] === undefined || newDepth < depths[childId]) {
        depths[childId] = newDepth;
        queue.push({ id: childId, depth: newDepth });
      }
    }
  }

  // Any metric still unassigned (e.g. circular refs) gets depth 0
  metrics.forEach(m => { if (depths[m.id] === undefined) depths[m.id] = 0; });

  return depths;
}

export function calculateDaysPassed(lastDate: string, currentDate: Date): number {
  const last = new Date(lastDate);
  const current = new Date(currentDate);
  last.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  return Math.floor((current.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}
