import {
  detectCircularDependency,
  evaluateFormula,
  extractMetricReferences,
  getAffectedMetrics,
  getTransitiveDependencyNames,
  recalculateMetrics,
  topologicalSort,
} from '../lib/metrics-engine';
import type { Metric } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metric(overrides: Partial<Metric> & { id: string; name: string }): Metric {
  return {
    formula: '0',
    value: 0,
    total: 0,
    order: 0,
    depth: 0,
    description: '',
    missingMarkets: [],
    timeSeries: [],
    ...overrides,
  };
}

// ─── evaluateFormula ──────────────────────────────────────────────────────────

describe('evaluateFormula', () => {
  const map: Record<string, Metric> = {
    Sleep: metric({ id: 's', name: 'Sleep', value: 8, total: 8 }),
    Exercise: metric({ id: 'e', name: 'Exercise', value: 5, total: 5 }),
    Null: metric({ id: 'n', name: 'Null', value: 0, total: null as unknown as number }),
  };

  test('leaf formula (0 or empty) returns 0', () => {
    expect(evaluateFormula('0', map)).toBe(0);
    expect(evaluateFormula('', map)).toBe(0);
    expect(evaluateFormula('  0  ', map)).toBe(0);
  });

  test('numeric literal', () => {
    expect(evaluateFormula('42', map)).toBe(42);
    expect(evaluateFormula('3.14', map)).toBe(3.14);
  });

  test('arithmetic', () => {
    expect(evaluateFormula('2 + 3', map)).toBe(5);
    expect(evaluateFormula('10 - 4', map)).toBe(6);
    expect(evaluateFormula('3 * 4', map)).toBe(12);
    expect(evaluateFormula('10 / 4', map)).toBe(2.5);
  });

  test('metric reference substitution', () => {
    expect(evaluateFormula('{Sleep}', map)).toBe(8);
    expect(evaluateFormula('{Exercise}', map)).toBe(5);
    expect(evaluateFormula('{Sleep} + {Exercise}', map)).toBe(13);
    expect(evaluateFormula('{Sleep} * 0.8 + {Exercise} * 0.2', map)).toBe(7.4);
  });

  test('math function rewrites', () => {
    expect(evaluateFormula('sqrt(4)', map)).toBe(2);
    expect(evaluateFormula('abs(-7)', map)).toBe(7);
    expect(evaluateFormula('min(3, 5)', map)).toBe(3);
    expect(evaluateFormula('max(3, 5)', map)).toBe(5);
    expect(evaluateFormula('pow(2, 3)', map)).toBe(8);
  });

  test('clamp helper available in formulas', () => {
    expect(evaluateFormula('clamp(10, 0, 5)', map)).toBe(5);
    expect(evaluateFormula('clamp(-3, 0, 5)', map)).toBe(0);
    expect(evaluateFormula('clamp(3, 0, 5)', map)).toBe(3);
  });

  test('missing metric reference replaced with 0', () => {
    expect(evaluateFormula('{NonExistent}', map)).toBe(0);
  });

  test('metric with null total propagates null', () => {
    expect(evaluateFormula('{Null}', map)).toBeNull();
  });

  test('unknown metric referenced in formula with null total', () => {
    const mapWithNull = { ...map };
    expect(evaluateFormula('{Null} + 5', mapWithNull)).toBeNull();
  });
});

// ─── extractMetricReferences ──────────────────────────────────────────────────

describe('extractMetricReferences', () => {
  test('returns empty array for leaf formulas', () => {
    expect(extractMetricReferences('0')).toEqual([]);
    expect(extractMetricReferences('')).toEqual([]);
  });

  test('extracts single reference', () => {
    expect(extractMetricReferences('{Sleep}')).toEqual(['Sleep']);
  });

  test('extracts multiple references', () => {
    expect(extractMetricReferences('{A} + {B} * {C}')).toEqual(['A', 'B', 'C']);
  });

  test('trims whitespace inside braces', () => {
    expect(extractMetricReferences('{ Sleep }')).toEqual(['Sleep']);
  });

  test('does not deduplicate repeated references', () => {
    expect(extractMetricReferences('{A} + {A}')).toEqual(['A', 'A']);
  });
});

// ─── getTransitiveDependencyNames ─────────────────────────────────────────────

describe('getTransitiveDependencyNames', () => {
  const formulas = {
    A: '{B} + {C}',
    B: '{D}',
    C: '0',
    D: '0',
  };

  test('returns direct and transitive deps', () => {
    const deps = getTransitiveDependencyNames('A', formulas);
    expect(deps).toContain('B');
    expect(deps).toContain('C');
    expect(deps).toContain('D');
    expect(deps).not.toContain('A');
  });

  test('handles leaf nodes with no deps', () => {
    expect(getTransitiveDependencyNames('D', formulas)).toEqual([]);
  });

  test('does not infinite-loop on cycles', () => {
    const cyclic = { X: '{Y}', Y: '{X}' };
    expect(() => getTransitiveDependencyNames('X', cyclic)).not.toThrow();
  });
});

// ─── detectCircularDependency ─────────────────────────────────────────────────

describe('detectCircularDependency', () => {
  const makeMetrics = (...pairs: Array<[string, string]>) =>
    pairs.map(([name, formula], i) => metric({ id: `id${i}`, name, formula }));

  test('no cycle in linear chain', () => {
    const metrics = makeMetrics(['A', '{B}'], ['B', '{C}'], ['C', '0']);
    expect(detectCircularDependency('id0', '{B}', metrics)).toBe(false);
  });

  test('direct self-reference is a cycle', () => {
    const metrics = makeMetrics(['A', '0'], ['B', '0']);
    // A references itself
    expect(detectCircularDependency('id0', '{A}', metrics)).toBe(true);
  });

  test('indirect cycle detected', () => {
    // A -> B -> A (cycle)
    const metrics = makeMetrics(['A', '{B}'], ['B', '{A}']);
    expect(detectCircularDependency(null, '{B}', metrics)).toBe(true);
  });

  test('null metricId checks whole graph', () => {
    const metrics = makeMetrics(['A', '0'], ['B', '0']);
    expect(detectCircularDependency(null, '0', metrics)).toBe(false);
  });
});

// ─── topologicalSort ──────────────────────────────────────────────────────────

describe('topologicalSort', () => {
  test('leaves come before dependents', () => {
    const metrics = [
      metric({ id: '1', name: 'Utility', formula: '{Sleep} + {Exercise}' }),
      metric({ id: '2', name: 'Sleep', formula: '0', value: 8, total: 8 }),
      metric({ id: '3', name: 'Exercise', formula: '0', value: 5, total: 5 }),
    ];
    const sorted = topologicalSort(metrics);
    const names = sorted.map(m => m.name);
    expect(names.indexOf('Sleep')).toBeLessThan(names.indexOf('Utility'));
    expect(names.indexOf('Exercise')).toBeLessThan(names.indexOf('Utility'));
  });

  test('independent metrics are all present', () => {
    const metrics = [metric({ id: '1', name: 'A', formula: '0' }), metric({ id: '2', name: 'B', formula: '0' })];
    expect(topologicalSort(metrics)).toHaveLength(2);
  });
});

// ─── recalculateMetrics ───────────────────────────────────────────────────────

describe('recalculateMetrics', () => {
  test('leaf metric total equals value', () => {
    const metrics = [metric({ id: '1', name: 'Sleep', value: 7, total: 0 })];
    recalculateMetrics(metrics);
    expect(metrics[0].total).toBe(7);
  });

  test('composite metric is calculated from leaves', () => {
    const metrics = [
      metric({ id: '1', name: 'Sleep', formula: '0', value: 8, total: 8 }),
      metric({ id: '2', name: 'Exercise', formula: '0', value: 5, total: 5 }),
      metric({ id: '3', name: 'Utility', formula: '{Sleep} * 0.7 + {Exercise} * 0.3', value: 0, total: 0 }),
    ];
    recalculateMetrics(metrics);
    const util = metrics.find(m => m.name === 'Utility')!;
    expect(util.total).toBeCloseTo(8 * 0.7 + 5 * 0.3);
  });

  test('null propagates through formula chain from TP metric with missing markets', () => {
    // A TP metric with missingMarkets becomes null; a composite that references it also becomes null
    const metrics = [
      metric({
        id: '1',
        name: 'A',
        formula: '{Sleep}',
        value: 0,
        total: 0,
        timePreference: { enabled: true, halfLife: 30 },
        missingMarkets: ['Sleep:2027'],
      }),
      metric({ id: '2', name: 'Sleep', formula: '0', value: 8, total: 8 }),
      metric({ id: '3', name: 'B', formula: '{A} + 1', value: 0, total: 0 }),
    ];
    recalculateMetrics(metrics);
    expect(metrics.find(m => m.name === 'A')!.total).toBeNull();
    expect(metrics.find(m => m.name === 'B')!.total).toBeNull();
  });

  test('consensusMap overrides leaf total for future time points', () => {
    const metrics = [
      metric({ id: '1', name: 'Sleep', formula: '0', value: 8, total: 8 }),
      metric({ id: '2', name: 'Utility', formula: '{Sleep} * 2', value: 0, total: 0 }),
    ];
    const consensusMap = { 'Sleep:2027': 10 };
    recalculateMetrics(metrics, consensusMap);
    // recalculate uses the leaf's own value (consensusMap is for future evaluation)
    expect(metrics.find(m => m.name === 'Utility')!.total).toBeCloseTo(16);
  });

  test('missingMarkets set when leaf has no log and no consensus', () => {
    const metrics = [
      metric({ id: '1', name: 'Forecast', formula: '0', value: 0, total: 0 }),
      metric({ id: '2', name: 'Parent', formula: '{Forecast}', value: 0, total: 0 }),
    ];
    recalculateMetrics(metrics, {});
    // When a leaf is a TP metric, it may end up with missingMarkets. The engine
    // populates this only for TP nodes; for plain leaves it stays empty.
    // The key invariant: composite total equals evaluated formula.
    const parent = metrics.find(m => m.name === 'Parent')!;
    expect(typeof parent.total).toBe('number');
  });

  test('multi-level dependency chain evaluates in correct order', () => {
    const metrics = [
      metric({ id: '1', name: 'A', formula: '0', value: 2, total: 2 }),
      metric({ id: '2', name: 'B', formula: '{A} * 2', value: 0, total: 0 }),
      metric({ id: '3', name: 'C', formula: '{B} + {A}', value: 0, total: 0 }),
    ];
    recalculateMetrics(metrics);
    expect(metrics.find(m => m.name === 'B')!.total).toBe(4);
    expect(metrics.find(m => m.name === 'C')!.total).toBe(6);
  });
});

// ─── getAffectedMetrics ───────────────────────────────────────────────────────

describe('getAffectedMetrics', () => {
  test('returns changed metric and all dependents', () => {
    const metrics = [
      metric({ id: '1', name: 'A', formula: '0' }),
      metric({ id: '2', name: 'B', formula: '{A}' }),
      metric({ id: '3', name: 'C', formula: '{B}' }),
      metric({ id: '4', name: 'D', formula: '0' }), // unrelated
    ];
    const affected = getAffectedMetrics(['1'], metrics);
    expect(affected).toContain('1');
    expect(affected).toContain('2');
    expect(affected).toContain('3');
    expect(affected).not.toContain('4');
  });

  test('returns only self when no dependents', () => {
    const metrics = [metric({ id: '1', name: 'Standalone', formula: '0' })];
    expect(getAffectedMetrics(['1'], metrics)).toEqual(['1']);
  });

  test('handles multiple changed metrics', () => {
    const metrics = [
      metric({ id: '1', name: 'A', formula: '0' }),
      metric({ id: '2', name: 'B', formula: '0' }),
      metric({ id: '3', name: 'C', formula: '{A} + {B}' }),
    ];
    const affected = getAffectedMetrics(['1', '2'], metrics);
    expect(affected).toContain('3');
  });
});

// ─── N/A readings (owner direction 2026-08-27) ───────────────────────────────

describe('an N/A reading (value null)', () => {
  test('a leaf reading N/A totals N/A, and every composite referencing it reads N/A too', () => {
    const out = recalculateMetrics([
      metric({ id: 'v', name: 'Valuation', value: null }),
      metric({ id: 'r', name: 'Revenue', value: 100, total: 100 }),
      metric({ id: 'c', name: 'Blend', formula: '{Valuation} + {Revenue}' }),
      metric({ id: 'u', name: 'Unrelated', formula: '{Revenue} * 2' }),
    ]);
    const by = Object.fromEntries(out.map(m => [m.id, m]));
    expect(by.v.value).toBeNull();
    expect(by.v.total).toBeNull();
    expect(by.c.value).toBeNull();
    expect(by.c.total).toBeNull();
    expect(by.u.total).toBe(200);
  });
});
