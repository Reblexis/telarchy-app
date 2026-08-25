import { evaluate, parseFormula } from '../lib/formula';
import { evaluateFormula, evaluateFormulaAtTime, validateFormula } from '../lib/metrics-engine';
import type { Metric } from '../types';

const run = (s: string, vars: Record<string, number | null> = {}) =>
  evaluate(parseFormula(s), name => (name in vars ? vars[name] : 0));

describe('formula evaluator', () => {
  test('each function', () => {
    expect(run('sqrt(16)')).toBe(4);
    expect(run('abs(-2.5)')).toBe(2.5);
    expect(run('log(1)')).toBe(0);
    expect(run('log10(100)')).toBe(2);
    expect(run('min(3, 1, 2)')).toBe(1);
    expect(run('max(3, 1, 2)')).toBe(3);
    expect(run('pow(3, 2)')).toBe(9);
    expect(run('2 ^ 0.5')).toBeCloseTo(Math.SQRT2);
  });

  test('clamp bounds, including lo greater than hi (min(max(v, lo), hi), as before)', () => {
    expect(run('clamp(10, 0, 5)')).toBe(5);
    expect(run('clamp(-3, 0, 5)')).toBe(0);
    expect(run('clamp(3, 0, 5)')).toBe(3);
    expect(run('clamp(3, 5, 0)')).toBe(0);
  });

  test('division by zero is Infinity, as JavaScript arithmetic gave before', () => {
    expect(run('1 / 0')).toBe(Infinity);
    expect(run('-1 / 0')).toBe(-Infinity);
  });

  test('null input propagates through every node type', () => {
    expect(run('{A}', { A: null })).toBeNull();
    expect(run('-{A}', { A: null })).toBeNull();
    expect(run('1 + {A}', { A: null })).toBeNull();
    expect(run('{A} * 0', { A: null })).toBeNull();
    expect(run('max(1, {A})', { A: null })).toBeNull();
    expect(run('{A} + {B}', { A: 1, B: 2 })).toBe(3);
  });

  test('NaN is returned raw by the evaluator; the engine maps it to 0', () => {
    expect(run('sqrt(-1)')).toBeNaN();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(evaluateFormula('sqrt(-1)', {})).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('engine behaviour preserved after the parser switch', () => {
  const metric = (m: Partial<Metric>): Metric =>
    ({
      id: 'x',
      name: 'x',
      value: 0,
      total: 0,
      formula: '0',
      order: 0,
      ...m,
    }) as Metric;
  const map = {
    Sleep: metric({ id: 's', name: 'Sleep', value: 8, total: 8 }),
    Null: metric({ id: 'n', name: 'Null', value: 0, total: null as unknown as number }),
  };

  test('syntax error evaluates to 0 with a logged error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(evaluateFormula('{Sleep} +', map)).toBe(0);
    expect(evaluateFormula('1 ? 2 : 3', map)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test('missing metric is 0, existing metric with null total is null', () => {
    expect(evaluateFormula('{Nope} + 1', map)).toBe(1);
    expect(evaluateFormula('{Null} + 1', map)).toBeNull();
  });

  test('^ now means power (production held no formula using it on 2026-08-24)', () => {
    expect(evaluateFormula('2 ^ 3', map)).toBe(8);
    expect(evaluateFormula('{Sleep} ^ 2', map)).toBe(64);
  });

  test('evaluateFormulaAtTime resolves leaves from consensus and recurses', () => {
    const nameToFormula = { Total: '{A} + {B}', A: '0', B: '{C} * 2', C: '' };
    const consensus = { 'A:2026-09': 1, 'C:2026-09': 5 };
    expect(evaluateFormulaAtTime('{Total}', nameToFormula, consensus, '2026-09')).toBe(11);
    expect(evaluateFormulaAtTime('{A} ^ 2 + 1', nameToFormula, consensus, '2026-09')).toBe(2);
  });

  test('evaluateFormulaAtTime on a syntax error is 0 with a logged error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(evaluateFormulaAtTime('{A} +', {}, {}, '2026-09')).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('validateFormula reports unknown metrics and syntax errors with a column', () => {
    const names = new Set(['Sleep']);
    expect(validateFormula('0', names)).toEqual([]);
    expect(validateFormula('{Sleep} * 2', names)).toEqual([]);
    expect(validateFormula('{Nope}', names)).toEqual([{ type: 'syntax_error', message: 'Unknown metric: {Nope}' }]);
    expect(validateFormula('{Sleep} +', names)).toEqual([
      { type: 'syntax_error', message: 'Invalid formula syntax: Unexpected end of formula at column 10' },
    ]);
    expect(validateFormula('1, 2', names)).toEqual([
      { type: 'syntax_error', message: 'Invalid formula syntax: Unexpected comma outside a function call at column 2' },
    ]);
    expect(validateFormula('sqrt(-1)', names)).toEqual([{ type: 'syntax_error', message: 'Formula evaluates to NaN' }]);
  });
});
