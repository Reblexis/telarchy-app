import type { Metric } from '../types';
import { toISOWeekString } from './date-utils';

// --- Time preference sampling (must stay in sync with backend time-preference.ts) ---

const WEIGHT_T0 = 1.0;
const N_SAMPLES = 10;

function fractionalYearsToDate(years: number, base: Date): string {
  const days = Math.max(1, Math.round(years * 365));
  const d = new Date(base);
  d.setDate(d.getDate() + days);

  if (years < 7 / 365) return d.toISOString().slice(0, 10);            // YYYY-MM-DD
  if (years < 1 / 12)  return toISOWeekString(d);                       // YYYY-Www
  if (years < 1)        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
  return String(d.getFullYear());                                        // YYYY
}

export function sampleTimePoints(halfLife: number): Array<{ date: string; weight: number }> {
  const seen = new Set<string>();
  const result: Array<{ date: string; weight: number }> = [];
  const base = new Date();
  const lambda = Math.LN2 / halfLife;
  for (let i = 1; i <= N_SAMPLES; i++) {
    const p = (2 * i - 1) / (2 * N_SAMPLES);
    const tYears = (-Math.log(1 - p)) / lambda;
    const date = fractionalYearsToDate(tYears, base);
    if (!seen.has(date)) {
      seen.add(date);
      result.push({ date, weight: 1.0 });
    }
  }
  return result;
}

// --- Formula evaluation ---

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
      console.error(`evaluateFormula: "${formula}" evaluated to NaN (expanded: "${expression}")`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormula: "${formula}" threw (expanded: "${expression}"):`, e);
    return 0;
  }
}

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
          memo[memoKey] = 0;
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
      console.error(`evaluateFormulaAtTime: "${formula}" evaluated to NaN at ${targetDate} (expanded: "${expression}")`);
      return 0;
    }
    return result;
  } catch (e) {
    console.error(`evaluateFormulaAtTime: "${formula}" threw at ${targetDate} (expanded: "${expression}"):`, e);
    return 0;
  }
}

export function extractMetricReferences(formula: string): string[] {
  if (!formula) return [];
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).trim());
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
    const fns = ['min', 'max', 'pow', 'sqrt', 'abs', 'clamp'];
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
    if (isLeaf) {
      metric.total = metric.value;
    } else if (metric.timePreference?.enabled) {
      if (metric.missingMarkets?.length) {
        metric.total = null;
      } else {
        const { halfLife } = metric.timePreference;
        const formula = metric.formula;

        const formulaAt0 = evaluateFormula(formula, nameToMetric);
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
    }
  });

  return metrics;
}

export const UNASSIGNED_DEPTH = 9999;

export function calculateMetricDepths(metrics: Metric[]): Record<string, number> {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => { nameToMetric[m.name] = m; });

  const children: Record<string, string[]> = {};
  metrics.forEach(metric => {
    const deps: string[] = [];
    for (const depName of extractMetricReferences(metric.formula || '0')) {
      const dep = nameToMetric[depName];
      if (dep) deps.push(dep.id);
    }
    children[metric.id] = deps;
  });

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

  metrics.forEach(metric => {
    if (depths[metric.id] === undefined) depths[metric.id] = UNASSIGNED_DEPTH;
  });

  return depths;
}

export function calculateXP(metrics: Metric[]): number | null {
  const utilityMetric = metrics.find(m => m.name === 'Utility');
  return utilityMetric ? utilityMetric.total : 0;
}

export function calculateRank(xp: number | null): string {
  if (xp === null) return '—';
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
