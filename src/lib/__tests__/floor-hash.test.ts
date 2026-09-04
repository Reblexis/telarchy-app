import { describe, expect, test } from 'vitest';
import { parseFloorHash } from '../floor-hash';

/**
 * What a floor URL's hash can point at (docs/ui-conventions.md, "A trade has
 * an address"): a proposal, a comment in its thread, a market, a trade.
 */
describe('parseFloorHash', () => {
  test('nothing to point at', () => {
    expect(parseFloorHash('')).toBeNull();
    expect(parseFloorHash('#')).toBeNull();
    expect(parseFloorHash('#account')).toBeNull();
  });

  test('a proposal, with the legacy contract= spelling', () => {
    expect(parseFloorHash('#proposal=p1')).toEqual({ proposal: 'p1', comment: null, market: null, trade: null });
    expect(parseFloorHash('#contract=p1')).toEqual({ proposal: 'p1', comment: null, market: null, trade: null });
  });

  test('a comment in a proposal thread', () => {
    expect(parseFloorHash('#proposal=p1&comment=c9')).toEqual({
      proposal: 'p1',
      comment: 'c9',
      market: null,
      trade: null,
    });
  });

  test('a trade on a baseline market', () => {
    expect(parseFloorHash('#market=m1&trade=t1')).toEqual({ proposal: null, comment: null, market: 'm1', trade: 't1' });
  });

  test('a trade on a proposal branch', () => {
    expect(parseFloorHash('#proposal=p1&trade=t1')).toEqual({
      proposal: 'p1',
      comment: null,
      market: null,
      trade: 't1',
    });
  });

  test('a market alone steps the page', () => {
    expect(parseFloorHash('market=m1')).toEqual({ proposal: null, comment: null, market: 'm1', trade: null });
  });
});
