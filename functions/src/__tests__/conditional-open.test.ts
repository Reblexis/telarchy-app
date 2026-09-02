/**
 * What a conditional pair is worth the moment it opens, before anyone trades.
 *
 * This is the arithmetic behind the number the public floor calls "impact",
 * and it broke three times in one day (2026-08-15), each time visibly and each
 * time differently:
 *
 *   1. Every approved branch on Telarchy's own floor priced at exactly 1.0 on
 *      a 0..50 range, because a dollar ask was subtracted from a metric
 *      counted in people and the clamp caught it at the floor.
 *   2. Every contract on that floor printed an identical -24 "impact" that no
 *      trader had anything to do with.
 *   3. The contractor rail read -$7,000 for an owner whose two contracts had
 *      never been priced by anyone: the burn alone, presented as a forecast.
 *
 * So the invariants are pinned here against the real functions, not mocks.
 * These are pure: no database, no HTTP, so they run in milliseconds and there
 * is no excuse for a change in this area to arrive without one.
 */

import { anchoredMarketState, consensus } from '../lib/amm';
import { isMonetaryMetric, metricCurrencyUnit } from '../lib/metric-unit';

/**
 * The opening state of one branch, exactly as createConditionalMarkets builds
 * it: anchor the branch at a probability across the metric's range, size the
 * book so the subsidy still covers the worst case, then read the price back.
 */
function openBranch(opts: {
  metricName: string;
  baseline: number;
  askUsd: number;
  branch: 'approved' | 'declined';
  rangeMin?: number;
  rangeMax: number;
  subsidy?: number;
}): number {
  const { metricName, baseline, askUsd, branch, rangeMax } = opts;
  const rangeMin = opts.rangeMin ?? 0;
  const subsidy = opts.subsidy ?? 250;
  const burn = isMonetaryMetric(metricName) ? askUsd : 0;
  const value = branch === 'approved' ? baseline - burn : baseline;
  const span = rangeMax - rangeMin;
  const p = (value - rangeMin) / span;
  const state = anchoredMarketState(subsidy, p);
  return consensus(state.shares, state.liquidity, rangeMin, rangeMax)!;
}

type OpenOpts = Parameters<typeof openBranch>[0];

/** What the floor prints as "impact" before anyone has traded the pair. */
const openingDelta = (opts: Omit<OpenOpts, 'branch'>) =>
  openBranch({ ...opts, branch: 'approved' }) - openBranch({ ...opts, branch: 'declined' });

describe('a metric counted in people', () => {
  const HEADCOUNT = { metricName: 'Weekly active verified traders', baseline: 25, rangeMax: 50 };

  test('opens both branches at the baseline, whatever the ask', () => {
    for (const askUsd of [0, 10, 300, 2000]) {
      expect(openBranch({ ...HEADCOUNT, askUsd, branch: 'approved' })).toBeCloseTo(25, 6);
      expect(openBranch({ ...HEADCOUNT, askUsd, branch: 'declined' })).toBeCloseTo(25, 6);
    }
  });

  test('opens with zero impact: an untraded pair predicts nothing', () => {
    for (const askUsd of [0, 10, 300, 2000]) {
      expect(openingDelta({ ...HEADCOUNT, askUsd })).toBeCloseTo(0, 6);
    }
  });

  test('never pins the approved branch at the range floor', () => {
    // The exact production failure: a $300 ask on a headcount drove the
    // anchor to -275, the clamp caught it at the floor, and every approved
    // branch printed 1.0 on a 0..50 range.
    const approved = openBranch({ ...HEADCOUNT, askUsd: 300, branch: 'approved' });
    expect(approved).toBeGreaterThan(1);
    expect(approved).toBeCloseTo(25, 6);
  });

  test('the identical fake impact across every contract cannot come back', () => {
    // Three contracts, three different asks, one metric. If the burn ever
    // applies again, all three collapse to the same clamped floor and print
    // the same delta, which is how the bug announced itself.
    const deltas = [200, 600, 1000].map(askUsd => openingDelta({ ...HEADCOUNT, askUsd }));
    expect(new Set(deltas.map(d => d.toFixed(6))).size).toBe(1);
    expect(deltas.every(d => Math.abs(d) < 1e-6)).toBe(true);
  });
});

describe('a metric counted in the same money as the ask', () => {
  const REVENUE = { metricName: 'LookPilot net 2026 (USD)', baseline: 78_000, rangeMax: 150_000 };

  test('the approved branch opens lower by exactly the ask', () => {
    expect(openBranch({ ...REVENUE, askUsd: 2000, branch: 'approved' })).toBeCloseTo(76_000, 4);
    expect(openBranch({ ...REVENUE, askUsd: 2000, branch: 'declined' })).toBeCloseTo(78_000, 4);
  });

  test('the opening impact is minus the ask, and nothing else', () => {
    for (const askUsd of [10, 2000, 5000]) {
      expect(openingDelta({ ...REVENUE, askUsd })).toBeCloseTo(-askUsd, 4);
    }
  });

  test('an ask larger than the number itself clamps instead of going negative', () => {
    // A $5,000 contract against a $2,000 metric would anchor below zero. The
    // clamp holds it inside the range, one part in a thousand above the
    // floor, so the delta stops tracking the ask. (The old 2% floor put this
    // branch at $200; on the Telarchy floor it put every revenue branch at
    // $20 against a $5 reading, owner report 2026-09-02.)
    const small = { metricName: 'Revenue (USD)', baseline: 2000, rangeMax: 10_000 };
    const approved = openBranch({ ...small, askUsd: 5000, branch: 'approved' });
    expect(approved).toBeGreaterThan(0);
    expect(approved).toBeCloseTo(10_000 * 0.001, 6);
    expect(openingDelta({ ...small, askUsd: 5000 })).toBeGreaterThan(-5000);
  });
});

describe('which metrics count as money', () => {
  test.each([
    ['LookPilot net 2026 (USD)', true],
    ['Revenue (monthly, USD)', true],
    ['Something ($)', true],
    ['Weekly active verified traders', false],
    ['Steam units (monthly)', false],
    ['Steam refund rate (%)', false],
    ['Tracking hours (monthly)', false],
    // The tail is the convention: a name merely mentioning dollars is not it.
    ['USD earned per user', false],
  ])('%s -> monetary: %s', (name, monetary) => {
    expect(isMonetaryMetric(name)).toBe(monetary);
    expect(metricCurrencyUnit(name)).toBe(monetary ? '$' : '');
  });

  test('the unit shown on the headline and the burn rule are the same decision', () => {
    // Two copies of this rule would eventually disagree, and the disagreement
    // would be a price nobody can explain.
    for (const name of ['A (USD)', 'B', 'C ($)', 'D (%)']) {
      expect(isMonetaryMetric(name)).toBe(metricCurrencyUnit(name) === '$');
    }
  });
});

describe('the anchored book itself', () => {
  test('a symmetric anchor holds no shares', () => {
    const state = anchoredMarketState(250, 0.5);
    expect(state.shares).toEqual([0, 0]);
    expect(state.liquidity).toBeCloseTo(250 / Math.LN2, 6);
  });

  test('no subsidy means no book at all, rather than a free one', () => {
    expect(anchoredMarketState(0, 0.4)).toEqual({ liquidity: 0, shares: [0, 0] });
    expect(anchoredMarketState(-5, 0.4)).toEqual({ liquidity: 0, shares: [0, 0] });
  });

  test('the anchor is where the market actually opens', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const state = anchoredMarketState(250, p);
      expect(consensus(state.shares, state.liquidity, 0, 1000)!).toBeCloseTo(p * 1000, 3);
    }
  });

  test('an extreme anchor is clamped, and the clamp is visible in the price', () => {
    // Callers must not read a clamped open as a market opinion: it is the
    // arithmetic refusing to place an infinite bet.
    // One part in a thousand of a 0..50 range: 0.05 and 49.95.
    const state = anchoredMarketState(250, -3);
    expect(consensus(state.shares, state.liquidity, 0, 50)!).toBeCloseTo(0.05, 6);
    const high = anchoredMarketState(250, 4);
    expect(consensus(high.shares, high.liquidity, 0, 50)!).toBeCloseTo(49.95, 6);
  });

  test('the subsidy bounds the worst case at every anchor', () => {
    // b * worstCase == subsidy is what makes an anchored open honest: the
    // seeded price is bought with a thinner book, never with credits nobody
    // paid in.
    for (const p of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      const { liquidity } = anchoredMarketState(250, p);
      const worst = Math.max(-Math.log(p), -Math.log(1 - p));
      expect(liquidity * worst).toBeCloseTo(250, 6);
    }
  });
});
