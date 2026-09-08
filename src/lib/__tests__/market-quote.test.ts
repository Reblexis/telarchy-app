import { describe, expect, test } from 'vitest';
import { previewTrade } from '../amm';
import { maxWinLabel, payoutLine, stakeExampleLine } from '../market-quote';

/**
 * The quote a market shows before anyone trades (docs/ui-conventions.md,
 * "An untouched ticket still quotes both sides"). One implementation, because
 * two surfaces say it: the floor's bet verbs and the ticket's side pills.
 */
describe('payoutLine', () => {
  test('names the range once, then the top, the bottom, and the credit a share pays', () => {
    // Critics' round 2 of 2026-09-08: the chart is zoomed, so "at 50" pointed
    // at a number the page never showed. The range is named first.
    expect(payoutLine('$', 0, 500_000)).toBe(
      'Settles between $0 and $500,000. A share pays 1 cr at $500,000, nothing at $0.',
    );
  });

  test('it stays short: two sentences, the second the rule the example follows', () => {
    // Owner, 2026-08-31, on the eighteen-word version: "this seems like too
    // much text". The range sentence is the one addition since.
    expect(payoutLine('', 0, 50).split(' ').length).toBeLessThanOrEqual(16);
  });

  test('range ends read as numbers a person would say, without trailing zeros', () => {
    expect(payoutLine('', 0, 50)).toBe('Settles between 0 and 50. A share pays 1 cr at 50, nothing at 0.');
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

/**
 * The stake example under each verb (docs/ui-conventions.md, "Each bet verb
 * says what a stake pays"): the payout at the range's edge, and, when the
 * chart's axis is zoomed inside the range, a second point at the visible
 * axis (critics' round 3): "25 cr pays 63 cr at 50, 41 cr at 20".
 */
describe('stakeExampleLine', () => {
  const shares = (dir: 'higher' | 'lower') => previewTrade(0.5, 200, dir, 25).shares;

  test('one point at the range edge when no axis is given', () => {
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'higher', 25)).toBe(
      `25 cr pays ${Math.round(shares('higher'))} cr at 50`,
    );
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'lower', 25)).toBe(
      `25 cr pays ${Math.round(shares('lower'))} cr at 0`,
    );
  });

  test('Higher adds the payout at the top of a zoomed axis', () => {
    const s = shares('higher');
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'higher', 25, { lo: 15, hi: 20 })).toBe(
      `25 cr pays ${Math.round(s)} cr at 50, ${Math.round((s * 20) / 50)} cr at 20`,
    );
  });

  test('Lower adds the payout at the floor of a zoomed axis, mirrored', () => {
    const s = shares('lower');
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'lower', 25, { lo: 15, hi: 20 })).toBe(
      `25 cr pays ${Math.round(s)} cr at 0, ${Math.round((s * (50 - 15)) / 50)} cr at 15`,
    );
  });

  test('the second point is in metric space, with the unit and the usual digits', () => {
    const s = shares('higher');
    expect(stakeExampleLine('$', 0, 500_000, 0.5, 200, 'higher', 25, { lo: 70_000, hi: 82_500 })).toBe(
      `25 cr pays ${Math.round(s)} cr at $500,000, ${Math.round((s * 82_500) / 500_000)} cr at $82,500`,
    );
  });

  test('an axis that already reaches the range top gives one point for Higher', () => {
    const s = Math.round(shares('higher'));
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'higher', 25, { lo: 10, hi: 50 })).toBe(`25 cr pays ${s} cr at 50`);
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'higher', 25, { lo: 10, hi: 60 })).toBe(`25 cr pays ${s} cr at 50`);
  });

  test('an axis floor at or under the range floor gives one point for Lower', () => {
    const s = Math.round(shares('lower'));
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'lower', 25, { lo: 0, hi: 20 })).toBe(`25 cr pays ${s} cr at 0`);
    expect(stakeExampleLine('', 10, 50, 0.5, 200, 'lower', 25, { lo: 5, hi: 20 })).toBe(`25 cr pays ${s} cr at 10`);
  });

  test('a second point outside the range is never quoted', () => {
    const up = Math.round(shares('higher'));
    const down = Math.round(shares('lower'));
    expect(stakeExampleLine('', 10, 50, 0.5, 200, 'higher', 25, { lo: 2, hi: 8 })).toBe(`25 cr pays ${up} cr at 50`);
    expect(stakeExampleLine('', 0, 50, 0.5, 200, 'lower', 25, { lo: 55, hi: 60 })).toBe(`25 cr pays ${down} cr at 0`);
  });

  test('an unfunded book still has no example', () => {
    expect(stakeExampleLine('', 0, 50, 0.5, 0, 'higher', 25, { lo: 15, hi: 20 })).toBeNull();
  });
});
