/**
 * Two doors to "where does a market open", and no third one.
 *
 * A market's opening price is not a default that each spawn path may pick for
 * itself. There were three paths that funded a fresh baseline market and only
 * one of them anchored, so the same market opened at its metric's value or at
 * the middle of its range depending on whether the owner's balance happened to
 * cover it that morning (owner report 2026-08-31). The fix was to give the
 * question one answer; this test is what keeps it one.
 *
 *  - `services/marketLiquidity.ts` opens BASELINE markets, at the metric's own
 *    current value (`anchorUntradedMarketTx`).
 *  - `services/proposals.ts` opens CONDITIONAL branches, at the baseline
 *    market's consensus adjusted for the branch and the contract's ask. That
 *    is a different question with a different input, which is why it is a
 *    second owner rather than a duplicate.
 *
 * A new caller of `anchoredMarketState` means a third opinion about opening
 * price. Route it through one of the two above instead.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..');
const OWNERS = ['lib/amm.ts', 'services/marketLiquidity.ts', 'services/proposals.ts'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map(f => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));

test('only the two opening-price owners call anchoredMarketState', () => {
  const callers = files
    .filter(f => !OWNERS.includes(f.path))
    // A mention in a comment is a pointer, not a second opinion.
    .filter(f => f.text.split('\n').some(line => /anchoredMarketState\(/.test(line) && !/^\s*(\*|\/\/)/.test(line)))
    .map(f => f.path);
  expect(callers).toEqual([]);
});

test('every funding path that opens a baseline market anchors it', () => {
  // The three call sites of applyAgentLiquidityInjectionTx that fund a market
  // nobody has traded. `routes/predictions.ts` has a fourth, the participant
  // "add liquidity" endpoint, which tops up a market that already has a price;
  // anchorUntradedMarketTx refuses that one on its own (shares are not [0, 0]),
  // so the count below is of files, not of call sites.
  const funders = files
    .filter(f => /applyAgentLiquidityInjectionTx\(/.test(f.text) && f.path !== 'services/marketLiquidity.ts')
    .map(f => f.path)
    .sort();
  expect(funders).toEqual(['routes/predictions.ts', 'services/markets.ts']);
  for (const path of funders) {
    const f = files.find(x => x.path === path);
    expect(f && /anchorUntradedMarketTx\(/.test(f.text)).toBe(true);
  }
});
