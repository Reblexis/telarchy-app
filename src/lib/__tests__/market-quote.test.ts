import { describe, expect, test } from 'vitest';
import { payoutLine, priceLabel } from '../market-quote';

/**
 * The quote a market shows before anyone trades (docs/ui-conventions.md,
 * "An untouched ticket still quotes both sides"). One implementation, because
 * two surfaces say it: the floor's bet verbs and the ticket's side pills.
 */
describe('priceLabel', () => {
  test('a price is the market number in cents', () => {
    expect(priceLabel(0.5)).toBe('50c');
    expect(priceLabel(0.14)).toBe('14c');
    expect(priceLabel(0.86)).toBe('86c');
  });

  test('it rounds to whole cents', () => {
    expect(priceLabel(0.1449)).toBe('14c');
    expect(priceLabel(0.1451)).toBe('15c');
  });

  test('never 0c: a live side is not free', () => {
    expect(priceLabel(0.001)).toBe('<1c');
    expect(priceLabel(0)).toBe('<1c');
    expect(priceLabel(0.004)).toBe('<1c');
    expect(priceLabel(0.006)).toBe('1c');
  });

  test('never 100c: a live side is not certain', () => {
    expect(priceLabel(0.999)).toBe('>99c');
    expect(priceLabel(1)).toBe('>99c');
    // 0.995 rounds to 100, which is the case that would have printed "100c".
    expect(priceLabel(0.995)).toBe('>99c');
    expect(priceLabel(0.994)).toBe('99c');
  });

  test('a probability outside [0, 1] is clamped rather than shown', () => {
    expect(priceLabel(-0.2)).toBe('<1c');
    expect(priceLabel(1.4)).toBe('>99c');
  });
});

describe('payoutLine', () => {
  test('names the top of the range, the bottom, and the credit a share pays', () => {
    expect(payoutLine('$', 0, 500_000)).toBe('A share pays 1 cr at $500,000, nothing at $0.');
  });

  test('it stays short: the price it explains is two characters wide', () => {
    // Owner, 2026-08-31, on the eighteen-word version: "this seems like too
    // much text". Eight words is the ceiling; anything longer reads as a
    // warning under the price rather than as its unit.
    expect(payoutLine('', 0, 50).split(' ').length).toBeLessThanOrEqual(10);
  });

  test('range ends read as numbers a person would say, without trailing zeros', () => {
    expect(payoutLine('', 0, 50)).toBe('A share pays 1 cr at 50, nothing at 0.');
  });

  test('a fractional end keeps the digits that matter', () => {
    expect(payoutLine('', 0, 2.5)).toContain('at 2.50,');
  });
});
