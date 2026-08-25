import { describe, expect, test } from 'vitest';
import { previewTargetBet, previewTrade } from '../amm';

/**
 * previewTargetBet powers the Markets-tab "Bet toward a value" hint. It mirrors
 * the backend betTowardsValue: buy in the direction that moves consensus toward
 * the target, buying exactly enough to hit it when that costs <= maxBudget,
 * otherwise spending the whole budget. The server response is authoritative;
 * these tests pin the preview's shape and the invariants a user relies on.
 *
 * Fixture: a healthy market, prob 0.5 (consensus 500 on a 0..1000 range),
 * liquidity b = 100.
 */
const B = 100;
const MIN = 0;
const MAX = 1000;
const consensusOf = (newProb: number) => MIN + newProb * (MAX - MIN);

describe('previewTargetBet', () => {
  test('reaches a lower target when the budget covers it', () => {
    const r = previewTargetBet(0.5, B, MIN, MAX, 300, 1e9)!;
    expect(r).not.toBeNull();
    expect(r.direction).toBe('lower');
    expect(r.shares).toBeGreaterThan(0);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.cost).toBeLessThanOrEqual(1e9);
    // Ample budget => lands on the target value.
    expect(consensusOf(r.newProb)).toBeCloseTo(300, 1);
  });

  test('reaches a higher target and reports direction higher', () => {
    const r = previewTargetBet(0.5, B, MIN, MAX, 800, 1e9)!;
    expect(r.direction).toBe('higher');
    expect(consensusOf(r.newProb)).toBeCloseTo(800, 1);
  });

  test('budget-caps: spends the whole budget and stops short of the target', () => {
    const r = previewTargetBet(0.5, B, MIN, MAX, 300, 1)!;
    // Only $1 of budget: cost is (approximately) the whole budget...
    expect(r.cost).toBeGreaterThan(0.9);
    expect(r.cost).toBeLessThanOrEqual(1 + 1e-6);
    // ...and consensus moves toward 300 but does not reach it.
    const landed = consensusOf(r.newProb);
    expect(landed).toBeLessThan(500);
    expect(landed).toBeGreaterThan(300);
  });

  test('agrees with previewTrade for the same budget-capped buy', () => {
    // A small budget toward a lower target is just a "lower" buy of that budget.
    const target = previewTargetBet(0.5, B, MIN, MAX, 100, 5)!;
    const direct = previewTrade(0.5, B, 'lower', 5);
    expect(target.direction).toBe('lower');
    expect(target.shares).toBeCloseTo(direct.shares, 3);
    expect(target.newProb).toBeCloseTo(direct.newProb, 4);
  });

  test('returns null for degenerate / no-op inputs', () => {
    expect(previewTargetBet(0.5, 0, MIN, MAX, 300, 100)).toBeNull(); // no liquidity
    expect(previewTargetBet(0.5, B, MIN, MAX, 500, 100)).toBeNull(); // target == current
    expect(previewTargetBet(0.5, B, MIN, MAX, 300, 0)).toBeNull(); // no budget
    expect(previewTargetBet(0.5, B, 1000, 0, 300, 100)).toBeNull(); // inverted range
  });

  test('clamps an out-of-range target toward the reachable bound', () => {
    // Target below rangeMin still resolves to a "lower" buy that spends budget.
    const r = previewTargetBet(0.5, B, MIN, MAX, -50, 10)!;
    expect(r.direction).toBe('lower');
    expect(r.cost).toBeGreaterThan(0);
  });
});
