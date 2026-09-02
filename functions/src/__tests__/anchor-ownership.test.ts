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
 *    market's consensus adjusted for the branch and the proposal's ask. That
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

test('every file that opens a book by hand also asks where it opens', () => {
  // `applyAgentLiquidityInjectionTx` anchors from the inside, so its callers
  // get the opening price without having to remember. Two paths write the
  // book themselves instead - POST /markets with a caller-stated liquidity,
  // and the bulk top-up, whose single credit debit covers a batch - and those
  // have to ask explicitly. Any OTHER file that starts writing
  // `markets.liquidity` is a sixth path, and the count of them going wrong so
  // far is five out of five (owner report 2026-08-31).
  const WRITES_BOOK = /\bliquidity:\s*(newLiquidity|liq)\b/;
  const handRolled = files
    .filter(f => f.path !== 'services/marketLiquidity.ts' && WRITES_BOOK.test(f.text))
    .map(f => f.path)
    .sort();
  // services/proposals.ts writes a book too and is deliberately absent: it
  // sets the state from its OWN anchor, which the first test above pins.
  expect(handRolled).toEqual(['routes/predictions.ts']);

  const predictions = files.find(f => f.path === 'routes/predictions.ts');
  expect(predictions && /anchorUntradedMarketTx\(/.test(predictions.text)).toBe(true);
});

test('a conditional branch is priced by one formula, wherever its book opens', () => {
  // The spawn (services/proposals.ts) and the first injection into a branch
  // that spawned unfunded (services/marketLiquidity.ts) both ask
  // lib/branch-anchor.ts where the branch opens: the baseline's consensus,
  // less the ask on the approved branch of a burning metric. Two copies of
  // that arithmetic would be the third opinion this file exists to prevent.
  for (const path of ['services/proposals.ts', 'services/marketLiquidity.ts']) {
    const f = files.find(x => x.path === path);
    expect(f && /from '\.\.\/lib\/branch-anchor'/.test(f.text)).toBe(true);
  }
  const helper = files.find(f => f.path === 'lib/branch-anchor.ts');
  expect(helper && /export function branchAnchorP\(/.test(helper.text)).toBe(true);
});
