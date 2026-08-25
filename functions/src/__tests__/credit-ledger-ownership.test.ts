/**
 * One door to agents.balance.
 *
 * `credit_ledger` is only worth having if it is complete. A partial ledger is
 * worse than none, because it reads as complete: a balance that does not
 * reconcile sends you hunting for a bug in the arithmetic when the real answer
 * is that some call site never wrote a row.
 *
 * So the rule is mechanical rather than remembered: `services/credits.ts` is
 * the only file allowed to write the balance column. Everything else calls
 * `applyCredits`, which does the update and the ledger insert in one
 * transaction, so a balance change without a record is not expressible.
 *
 * This is the floor-horizons-ownership test in backend form, and it exists
 * because the naive version of it missed a real case: POST /reset-economy
 * wrote `balance: 0` rather than a sql`` expression, so a pattern that only
 * looked for interpolated SQL would have declared the codebase clean while the
 * single most destructive endpoint bypassed the ledger entirely.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..');
const OWNER = 'services/credits.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map(f => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));

/**
 * A write assigns the column something new: an interpolated expression, a
 * literal, or a unit conversion. A read assigns it a column reference or a
 * formatter (`balance: agents.balance`, `balance: fromUnits(row.balance)`),
 * which is how every response payload and select projection spells it.
 */
const WRITE = /\bbalance:\s*(sql`|\d|toUnits\(|-)/;

/**
 * Creating a participant row AT ZERO is not a balance change: the signup grant
 * that follows moves the money and writes the row. So `balance: 0` inside an
 * insert is fine, and the same literal inside an update is not.
 *
 * That distinction is the whole point rather than a convenience. The endpoint
 * that made this test necessary, POST /reset-economy, zeroed every balance in
 * a workspace with exactly `balance: 0` in an UPDATE.
 */
function writeSites(text: string): number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!WRITE.test(line)) return;
    const zeroLiteral = /\bbalance:\s*0\s*,?\s*$/.test(line);
    if (zeroLiteral) {
      // Walk back to whichever statement opened this object literal.
      for (let j = i; j >= 0 && j > i - 12; j--) {
        if (/\.insert\(/.test(lines[j])) return;
        if (/\.update\(|\.set\(\{/.test(lines[j])) break;
      }
    }
    hits.push(i + 1);
  });
  return hits;
}

test('the scan actually sees the backend', () => {
  // A guard on the guard: a broken walk makes every rule below vacuous.
  expect(files.length).toBeGreaterThan(40);
  expect(files.map(f => f.path)).toContain(OWNER);
  expect(files.map(f => f.path)).toContain('services/trading.ts');
});

test('only services/credits.ts writes agents.balance', () => {
  const offenders = files
    .filter(f => f.path !== OWNER)
    .flatMap(f => writeSites(f.text).map(line => `${f.path}:${line}`));

  expect(offenders).toEqual([]);
});

test('applyCredits always writes a ledger row beside the balance change', () => {
  // Structural, not behavioural: the balance update and the insert must live
  // in the same function, so no future refactor can leave the insert on a
  // branch that some callers skip.
  const owner = files.find(f => f.path === OWNER)!.text;
  const fn = owner.slice(owner.indexOf('export async function applyCreditsIfSufficient'));
  expect(fn).toMatch(/update\(agents\)/);
  expect(fn).toMatch(/insert\(creditLedger\)/);
  expect(fn.indexOf('update(agents)')).toBeLessThan(fn.indexOf('insert(creditLedger)'));
});

test('reset-economy is gone rather than guarded', () => {
  // Owner decision 2026-08-18: it zeroed every balance and deleted every trade
  // behind the ordinary `manage` capability. Deleted rather than gated,
  // because a gate has to be remembered.
  const offenders = files.filter(f => /reset-economy'/.test(f.text)).map(f => f.path);
  expect(offenders).toEqual([]);
});

test('the detector still catches a zeroing UPDATE', () => {
  // Without this, softening the rule for inserts would quietly re-open the
  // exact hole that made the rule necessary.
  const zeroingUpdate = [
    'await tx.update(agents).set({',
    '  balance: 0, earnedBetting: 0,',
    '}).where(inArray(agents.id, wsAgentIds));',
  ].join('\n');
  expect(writeSites(zeroingUpdate)).toEqual([2]);

  const creatingRow = [
    'await tx.insert(agents).values({',
    '  id: agentId, apiKeyHash: keyHash, balance: 0,',
    '});',
  ].join('\n');
  expect(writeSites(creatingRow)).toEqual([]);
});
