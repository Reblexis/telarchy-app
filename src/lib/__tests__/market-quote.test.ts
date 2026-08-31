import { describe, expect, test } from 'vitest';
import { previewTrade } from '../amm';
import { maxWinLabel, payoutLine } from '../market-quote';

/**
 * The quote a market shows before anyone trades (docs/ui-conventions.md,
 * "An untouched ticket still quotes both sides"). One implementation, because
 * two surfaces say it: the floor's bet verbs and the ticket's side pills.
 */
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

describe('maxWinLabel', () => {
  test('the ceiling is the liquidity times the log of one over the price', () => {
    // b = 574.95 at 30c: 574.95 * ln(1/0.296) = 700 credits, and not a
    // credit more however much anyone spends.
    expect(maxWinLabel(0.296, 574.9528711325589)).toBe('700 cr');
  });

  test('NO STAKE BEATS THE CEILING, which is the whole claim the label makes', () => {
    const b = 574.9528711325589;
    const p = 0.296;
    const ceiling = b * Math.log(1 / p);
    for (const spend of [1, 10, 73, 500, 5_000, 50_000]) {
      const { shares } = previewTrade(p, b, 'higher', spend, null);
      // Every share pays at most a credit, so this is the best the bet can do.
      expect(shares - spend).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });

  test('and it is approached, not merely bounded', () => {
    const b = 574.9528711325589;
    const { shares } = previewTrade(0.296, b, 'higher', 5_000, null);
    expect(shares - 5_000).toBeGreaterThan(b * Math.log(1 / 0.296) * 0.99);
  });

  test('a thin market says how thin it is', () => {
    // 12 credits of liquidity at even odds: eight credits on the table.
    expect(maxWinLabel(0.5, 12)).toBe('8.3 cr');
  });

  test('the dear side has less on the table than the cheap one', () => {
    expect(maxWinLabel(0.88, 330.1476387480261)).toBe('42 cr');
    expect(maxWinLabel(0.12, 330.1476387480261)).toBe('700 cr');
  });

  test('a nearly certain side has almost nothing to win', () => {
    expect(maxWinLabel(0.999, 200)).toBe('<1 cr');
  });

  test('an unfunded market has no ceiling to state', () => {
    // A market with no liquidity has no price either; it refuses trades.
    expect(maxWinLabel(0.5, 0)).toBeNull();
    expect(maxWinLabel(0.5, Number.NaN)).toBeNull();
  });

  test('a free side would have no ceiling, so it states none', () => {
    expect(maxWinLabel(0, 200)).toBeNull();
  });
});
