import { describe, expect, test } from 'vitest';
import { previewTrade } from '../amm';
import { maxWinLabel, rangeLine, stakePreview } from '../market-quote';

/**
 * The quote a market shows before anyone trades (docs/ui-conventions.md,
 * "The verbs and the inline ticket"). One implementation, because two
 * surfaces say it: the floor's bet verbs and the ticket's rows.
 */
describe('rangeLine', () => {
  test('states BOTH directions, the rule the two previews follow', () => {
    expect(rangeLine('', 0, 50)).toBe(
      'Range 0 to 50 · Higher shares pay 1 cr at 50, Lower shares pay 1 cr at 0; in between, in proportion · you can sell any time',
    );
  });

  test("the range is named first, in the metric's own unit", () => {
    expect(rangeLine('$', 0, 500_000)).toBe(
      'Range $0 to $500,000 · Higher shares pay 1 cr at $500,000, Lower shares pay 1 cr at $0; in between, in proportion · you can sell any time',
    );
  });

  test('it stays ONE line: no sentence of explanation under a number', () => {
    // Owner, 2026-08-31, on the eighteen-word version: "this seems like too
    // much text". Three clauses on middle dots, never a paragraph.
    const line = rangeLine('', 0, 50);
    expect(line).not.toContain('\n');
    expect(line.split('·').length).toBe(3);
  });

  test('range ends read as numbers a person would say, without trailing zeros', () => {
    expect(rangeLine('', 0, 50)).toContain('Range 0 to 50 ·');
  });

  test('a fractional end keeps the digits that matter', () => {
    expect(rangeLine('', 0, 2.5)).toContain('Range 0 to 2.50 ·');
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
 * The payout preview under each verb (docs/ui-conventions.md, "The verbs
 * and the inline ticket", row 2): what the stake in the field pays at the
 * range's edge, and the profit beside it, quoted by the same LMSR preview
 * the ticket runs.
 */
describe('stakePreview', () => {
  const shares = (dir: 'higher' | 'lower') => previewTrade(0.5, 200, dir, 25).shares;
  const cr = (n: number) => Math.round(n).toLocaleString('en-US');

  test('the payout at the range edge, then the profit', () => {
    const up = shares('higher');
    expect(stakePreview('', 0, 50, 0.5, 200, 'higher', 25)?.line).toBe(
      `25 cr pays ${cr(up)} cr at 50 · +${cr(up - 25)}`,
    );
    const down = shares('lower');
    expect(stakePreview('', 0, 50, 0.5, 200, 'lower', 25)?.line).toBe(
      `25 cr pays ${cr(down)} cr at 0 · +${cr(down - 25)}`,
    );
  });

  test('the payout IS the shares: one credit per share at that edge', () => {
    const q = stakePreview('', 0, 50, 0.5, 200, 'higher', 25)!;
    expect(q.pays).toBe(q.shares);
    expect(q.profit).toBeCloseTo(q.shares - 25, 9);
  });

  test('never the stake divided by the displayed call', () => {
    // 25 cr at a call of 25 on a 0-50 range would be 50 cr under the wrong
    // arithmetic; the AMM preview says otherwise.
    const q = stakePreview('', 0, 50, 0.5, 200, 'higher', 25)!;
    expect(Math.round(q.pays)).not.toBe(50);
  });

  test("the edge carries the metric's unit and the usual digits", () => {
    expect(stakePreview('$', 0, 500_000, 0.5, 200, 'higher', 25)?.edge).toBe('$500,000');
    expect(stakePreview('$', 0, 500_000, 0.5, 200, 'lower', 25)?.edge).toBe('$0');
  });

  test('the echo the sign-up door prints drops the profit', () => {
    const up = shares('higher');
    expect(stakePreview('', 0, 50, 0.5, 200, 'higher', 25)?.echo).toBe(`25 cr · pays ${cr(up)} cr at 50`);
  });

  test('a nearly certain side pays back barely more than the stake', () => {
    // The edge payout can never be less than the stake on an LMSR buy, so
    // the sign is what has to stay honest: the profit is quoted, not assumed.
    const q = stakePreview('', 0, 50, 0.999, 1_000_000, 'higher', 25)!;
    expect(q.profit).toBeGreaterThanOrEqual(0);
    expect(q.line).toContain(' · +');
    expect(q.pays).toBeGreaterThanOrEqual(25);
  });

  test('an unfunded book still has no preview', () => {
    expect(stakePreview('', 0, 50, 0.5, 0, 'higher', 25)).toBeNull();
    expect(stakePreview('', 0, 50, 0.5, Number.NaN, 'higher', 25)).toBeNull();
  });

  test('a stake of nothing has nothing to quote', () => {
    expect(stakePreview('', 0, 50, 0.5, 200, 'higher', 0)).toBeNull();
    expect(stakePreview('', 0, 50, 0.5, 200, 'higher', Number.NaN)).toBeNull();
  });
});
