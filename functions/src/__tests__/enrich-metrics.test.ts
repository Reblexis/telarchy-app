import { enrichMetrics } from '../services/metrics';
import type { Metric } from '../types';

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

describe('enrichMetrics inheritedHalfLife', () => {
  test('descendant of TP-enabled metric inherits halfLife even with no consensus data', () => {
    // Self control (TP, halfLife=1) -> Current self control -> Unhealthy addictions (leaf)
    const tpMetric = metric({
      id: 'sc',
      name: 'Self control',
      formula: '{Current self control}',
      timePreference: { enabled: true, halfLife: 1, density: 3 },
    });
    const intermediate = metric({
      id: 'csc',
      name: 'Current self control',
      formula: '(1000 - {Unhealthy addictions}) / 2',
    });
    const leaf = metric({ id: 'ua', name: 'Unhealthy addictions', formula: '0' });

    const result = enrichMetrics([tpMetric, intermediate, leaf], {});

    const leafResult = result.find(m => m.name === 'Unhealthy addictions')!;
    const intermediateResult = result.find(m => m.name === 'Current self control')!;

    expect(leafResult.inheritedHalfLife).toBe(1);
    expect(intermediateResult.inheritedHalfLife).toBe(1);
  });

  test('leaf with TP enabled does not get inheritedHalfLife (its own TP drives the overlay)', () => {
    const leafTp = metric({
      id: 'l',
      name: 'Sleep',
      formula: '0',
      timePreference: { enabled: true, halfLife: 2, density: 3 },
    });

    const result = enrichMetrics([leafTp], {});
    expect(result[0].inheritedHalfLife).toBeUndefined();
  });

  test('metric outside any TP subtree has no inheritedHalfLife', () => {
    const tp = metric({
      id: 'a',
      name: 'A',
      formula: '0',
      timePreference: { enabled: true, halfLife: 1, density: 3 },
    });
    const unrelated = metric({ id: 'b', name: 'B', formula: '0' });

    const result = enrichMetrics([tp, unrelated], {});
    expect(result.find(m => m.name === 'B')!.inheritedHalfLife).toBeUndefined();
  });
});
