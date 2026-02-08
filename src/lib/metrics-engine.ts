import type { Metric } from '../types';

export function evaluateFormula(formula: string, metricsMap: Record<string, Metric>): number {
  if (!formula || formula.trim() === '0' || formula.trim() === '') {
    return 0;
  }

  let expression = formula;
  const metricRefs = formula.match(/\{([^}]+)\}/g);

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

  const result = eval(expression);
  return isNaN(result) ? 0 : result;
}

export function extractMetricReferences(formula: string): string[] {
  if (!formula) return [];
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).trim());
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
    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depId = nameToId[depName];
      if (depId && dependents[depId]) {
        dependents[depId].push(metric.id);
      }
    });
  });

  const affected = new Set(changedMetricIds);
  const queue = [...changedMetricIds];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const deps = dependents[currentId] || [];
    for (const depId of deps) {
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
  metrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });

  const chain = new Set([metricId]);

  const children = getAffectedMetrics([metricId], metrics);
  children.forEach(id => chain.add(id));

  const visited = new Set<string>();
  function addParents(currentId: string) {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    const metric = idToMetric[currentId];
    if (metric && metric.formula) {
      const deps = extractMetricReferences(metric.formula);
      deps.forEach(depName => {
        const depId = nameToId[depName];
        if (depId) {
          chain.add(depId);
          addParents(depId);
        }
      });
    }
  }

  addParents(metricId);
  return Array.from(chain);
}

export function detectCircularDependency(metricId: string | null, formula: string, allMetrics: Metric[]): boolean {
  const tempMetrics = allMetrics.map(m =>
    m.id === metricId ? { ...m, formula } : m
  );

  const nameToId: Record<string, string> = {};
  const idToMetric: Record<string, Metric> = {};
  tempMetrics.forEach(m => {
    nameToId[m.name] = m.id;
    idToMetric[m.id] = m;
  });

  if (metricId) {
    const dependencies = extractMetricReferences(formula);
    for (const depName of dependencies) {
      const depId = nameToId[depName];
      if (depId === metricId) return true;
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
      const deps = extractMetricReferences(current.formula);
      for (const depName of deps) {
        const depId = nameToId[depName];
        if (depId && hasCycle(depId)) {
          return true;
        }
      }
    }

    recStack.delete(currentId);
    return false;
  }

  if (metricId) {
    return hasCycle(metricId);
  }

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
    if (temp.has(metric.id)) return;
    if (visited.has(metric.id)) return;

    temp.add(metric.id);

    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depMetric = nameToMetric[depName];
      if (depMetric) {
        visit(depMetric);
      }
    });

    temp.delete(metric.id);
    visited.add(metric.id);
    sorted.push(metric);
  }

  metrics.forEach(metric => {
    if (!visited.has(metric.id)) {
      visit(metric);
    }
  });

  return sorted;
}

export function recalculateMetrics(metrics: Metric[]): Metric[] {
  const sorted = topologicalSort(metrics);
  const nameToMetric: Record<string, Metric> = {};

  sorted.forEach(m => {
    nameToMetric[m.name] = m;
  });

  sorted.forEach(metric => {
    const formulaResult = evaluateFormula(metric.formula || '0', nameToMetric);
    metric.total = metric.value + formulaResult;
  });

  return metrics;
}

export function calculateMetricDepths(metrics: Metric[]): Record<string, number> {
  const nameToMetric: Record<string, Metric> = {};
  metrics.forEach(m => {
    nameToMetric[m.name] = m;
  });

  const dependents: Record<string, string[]> = {};
  metrics.forEach(m => {
    dependents[m.id] = [];
  });

  metrics.forEach(metric => {
    const deps = extractMetricReferences(metric.formula || '0');
    deps.forEach(depName => {
      const depMetric = nameToMetric[depName];
      if (depMetric) {
        dependents[depMetric.id].push(metric.id);
      }
    });
  });

  const depths: Record<string, number> = {};
  const visited = new Set<string>();

  function getDepth(metricId: string): number {
    if (depths[metricId] !== undefined) {
      return depths[metricId];
    }

    if (visited.has(metricId)) {
      return 0;
    }

    visited.add(metricId);

    const deps = dependents[metricId] || [];
    if (deps.length === 0) {
      depths[metricId] = 0;
    } else {
      let minDepth = Infinity;
      for (const depId of deps) {
        const depDepth = getDepth(depId);
        minDepth = Math.min(minDepth, depDepth + 1);
      }
      depths[metricId] = minDepth;
    }

    visited.delete(metricId);
    return depths[metricId];
  }

  metrics.forEach(metric => {
    getDepth(metric.id);
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
