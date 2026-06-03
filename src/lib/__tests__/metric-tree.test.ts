import { describe, test, expect } from 'vitest';
import type { Metric } from '../../types';
import { isCompositeMetric, getLeafDescendantIds } from '../metric-tree';

function metric(id: string, name: string, formula: string, extra: Partial<Metric> = {}): Metric {
  return {
    id, name, description: '', value: 0, total: 0, formula,
    order: 0, depth: 0, ...extra,
  };
}

// Tree (formula refs use each metric's exact name, as the real engine requires):
//   Root = {A} + {Mid}        (composite, depth 0)
//   Mid  = {B} + {C}          (composite, depth 1)
//   A, B, C                   (leaves)
const root = metric('root', 'Root', '{A} + {Mid}', { depth: 0 });
const mid = metric('mid', 'Mid', '{B} + {C}', { depth: 1 });
const a = metric('a', 'A', '0', { depth: 1 });
const b = metric('b', 'B', '0', { depth: 2 });
const c = metric('c', 'C', '', { depth: 2 });
const all = [root, mid, a, b, c];

describe('isCompositeMetric', () => {
  test('formula referencing children is composite', () => {
    expect(isCompositeMetric(root)).toBe(true);
    expect(isCompositeMetric(mid)).toBe(true);
  });
  test("'0' and empty formulas are leaves", () => {
    expect(isCompositeMetric(a)).toBe(false); // '0'
    expect(isCompositeMetric(c)).toBe(false); // ''
    expect(isCompositeMetric({ formula: '   ' })).toBe(false);
  });
});

describe('getLeafDescendantIds', () => {
  test('leaf has no descendants', () => {
    expect(getLeafDescendantIds('a', all)).toEqual(new Set());
    expect(getLeafDescendantIds('b', all)).toEqual(new Set());
  });
  test('mid resolves to its two leaf children', () => {
    expect(getLeafDescendantIds('mid', all)).toEqual(new Set(['b', 'c']));
  });
  test('root resolves transitively to all leaves, not intermediate composites', () => {
    expect(getLeafDescendantIds('root', all)).toEqual(new Set(['a', 'b', 'c']));
  });
  test('unknown id returns empty set', () => {
    expect(getLeafDescendantIds('nope', all)).toEqual(new Set());
  });
});
