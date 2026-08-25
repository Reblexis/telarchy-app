#!/usr/bin/env node
/**
 * Compare the retired Function()-based formula evaluator with the parser in
 * functions/src/lib/formula over a dump of stored formulas.
 *
 *   node scripts/formula-parity.mjs <formulas.json>
 *
 * The JSON is an array of { workspace, name, formula } (extra fields ignored).
 * Every non-leaf formula is evaluated by both implementations against two
 * metric maps (every reference = 0, every reference = 1) and any difference or
 * rejection is printed. Zero rows means the switch is invisible to stored data.
 * Spec: docs/formulas.md ("History").
 *
 * The old evaluator below is a verbatim copy of what metrics-engine.ts did
 * before 2026-08-24, kept here only as the reference for this comparison. It is
 * the one place in the repo that still evaluates a formula as JavaScript, on
 * data you pass it explicitly, never on stored data at runtime.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/formula-parity.mjs <formulas.json>');
  process.exit(2);
}

function retiredEvaluate(formula, value) {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return 0;
  let expression = formula;
  const refs = expression.match(/\{([^}]+)\}/g);
  if (refs) for (const ref of refs) expression = expression.replace(ref, String(value));
  expression = expression.replace(/sqrt\(/g, 'Math.sqrt(');
  expression = expression.replace(/abs\(/g, 'Math.abs(');
  expression = expression.replace(/log10\(/g, 'Math.log10(');
  expression = expression.replace(/log\(/g, 'Math.log(');
  expression = expression.replace(/min\(/g, 'Math.min(');
  expression = expression.replace(/max\(/g, 'Math.max(');
  expression = expression.replace(/pow\(/g, 'Math.pow(');
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  try {
    // Retired reference implementation (JavaScript eval of the rewritten string).
    const result = new Function('clamp', 'return (' + expression + ')')(clamp);
    return Number.isNaN(result) ? 0 : result;
  } catch {
    return 0;
  }
}

const engine = await import(pathToFileURL(resolve('functions/lib/lib/formula/index.js')).href).catch(async () => {
  console.error('Build the backend first (cd functions && npm run build) so functions/lib exists.');
  process.exit(2);
});

function newEvaluate(formula, value) {
  if (!formula || formula.trim() === '0' || formula.trim() === '') return { value: 0 };
  try {
    const ast = engine.parseFormula(formula);
    const v = engine.evaluate(ast, () => value);
    return { value: Number.isNaN(v) ? 0 : v };
  } catch (e) {
    return { rejected: e.message };
  }
}

const rows = JSON.parse(readFileSync(file, 'utf8'));
const nonLeaf = rows.filter(r => r.formula && r.formula.trim() !== '' && r.formula.trim() !== '0');
console.log(`${rows.length} metrics, ${nonLeaf.length} non-leaf formulas`);
let diffs = 0;
for (const r of nonLeaf) {
  for (const value of [0, 1]) {
    const a = retiredEvaluate(r.formula, value);
    const b = newEvaluate(r.formula, value);
    const same = !('rejected' in b) && Object.is(a, b.value);
    if (!same) {
      diffs++;
      console.log(
        `DIFF  ${r.workspace ?? ''} | ${r.name ?? ''} | ${JSON.stringify(r.formula)} | refs=${value} | old=${a} new=${'rejected' in b ? 'REJECTED: ' + b.rejected : b.value}`,
      );
    }
  }
}
console.log(diffs === 0 ? 'parity: OK, no differences' : `parity: ${diffs} difference(s)`);
process.exit(diffs === 0 ? 0 : 1);
