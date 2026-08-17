import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * A drift guard, in the shape of the api-parity test: the rules that keep the
 * floor's horizon model in one place are checked mechanically, because the
 * three bugs they prevent all came back the moment a second copy existed.
 *
 * The rules:
 *   1. The payload's price replay (`marketHistory`) is read only through
 *      `priceSeriesOf`, which keys it by market id. Read directly, it becomes
 *      "some market's prices" and gets drawn under the wrong chart.
 *   2. Nobody outside the model reverses or end-indexes `markets`. Position is
 *      not a role: that convention flipped once and printed "speed, not the
 *      decision" beside "end of 2026".
 *   3. There is exactly one definition of each label helper. Two copies of
 *      `currencyOf` is a unit disagreeing with itself on the same page.
 *
 * A legitimate exception belongs in the allowlist below, with the reason.
 */

const SRC = resolve(__dirname, '../..');
const MODEL = 'lib/floor-horizons.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' || name === 'test' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map(f => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));

test('the scan actually sees the frontend', () => {
  // A guard on the guard: a broken walk would make every rule below vacuous.
  expect(files.length).toBeGreaterThan(20);
  expect(files.map(f => f.path)).toContain(MODEL);
  expect(files.map(f => f.path)).toContain('pages/TradePage.tsx');
});

describe('the price replay is read by market id', () => {
  const ALLOWED = new Set([
    MODEL,     // priceSeriesOf itself, the one place that may key it
    'lib/api.ts', // the type declaration
  ]);

  test('nothing else touches ws.marketHistory', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .filter(f => /\bmarketHistory(MarketId)?\b/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('a horizon\'s role comes from the model, not from its index', () => {
  const ALLOWED = new Set([MODEL]);

  test('nobody else reverses the markets list', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .filter(f => /markets\s*\??\.?\s*\]?\s*\)?\s*\.reverse\(\)/.test(f.text)
        || /\[\s*\.\.\.\s*\(?\s*\w*\.?markets[^\]]*\]\s*\.reverse\(\)/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  test('nobody end-indexes markets or horizonHistories to mean "the primary"', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .filter(f => /(markets|horizonHistories|horizons)\s*\[[^\]]*\.length\s*-\s*1[^\]]*\]/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('one definition of each label helper', () => {
  test.each(['currencyOf', 'settleDayOf', 'horizonLabel', 'metricLabelOf', 'buildHorizonViews', 'priceSeriesOf'])(
    '%s is defined once, in the model',
    name => {
      const definers = files.filter(f => new RegExp(`function ${name}\\b`).test(f.text)).map(f => f.path);
      expect(definers).toEqual([MODEL]);
    },
  );

  test('the model is imported, not re-exported through a page', () => {
    // Components importing floor helpers from a PAGE is how they ended up
    // there in the first place; a page is not a library.
    const offenders = files
      .filter(f => /import\s*\{[^}]*\b(settleDayOf|horizonLabel|currencyOf)\b[^}]*\}\s*from\s*['"][^'"]*pages\/TradePage['"]/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});
