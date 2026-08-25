import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, test } from 'vitest';

/**
 * A drift guard, in the shape of floor-horizons-ownership: the app is built
 * twice, at `/` and at `/beta/` (docs/infra/deploy.md), and a root-absolute
 * URL written anywhere in the frontend silently walks a /beta visitor back
 * onto the production build. That shipped (owner report 2026-08-21: "beta
 * doesnt link to other beta links.. all beta pages should link to other beta
 * pages"), so the rules are checked mechanically:
 *
 *   1. Internal navigation goes through react-router (<Link>/navigate()),
 *      which inherits the basename. No root-absolute href literals.
 *   2. No `window.location.href = '/...'` navigation; navigate() knows the
 *      base, location.href does not.
 *   3. The rare genuine URL (a server endpoint, the served index) goes
 *      through `withBase` in lib/base-path.ts, and `import.meta.env.BASE_URL`
 *      is read there and nowhere else, so there is exactly one definition of
 *      "where is this app mounted".
 *
 * A legitimate exception belongs in an allowlist below, with the reason.
 */

const SRC = resolve(__dirname, '../..');
const BASE_MODULE = 'lib/base-path.ts';

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
  expect(files.length).toBeGreaterThan(20);
  expect(files.map(f => f.path)).toContain(BASE_MODULE);
  expect(files.map(f => f.path)).toContain('pages/TradePage.tsx');
});

describe('no root-absolute internal URLs outside the base module', () => {
  test('no href="/..." literals: use <Link to>, or withBase for real URLs', () => {
    // href="/x", href={'/x'}, href={`/x`}. Protocol-relative (//) is external
    // and not matched.
    const offenders = files.filter(f => /href=\{?["'`]\/(?!\/)/.test(f.text)).map(f => f.path);
    expect(offenders).toEqual([]);
  });

  test('no window.location.href = "/..." navigation: use navigate()', () => {
    const offenders = files
      .filter(f => /(window\.)?location\.(href\s*=|assign\(|replace\()\s*["'`]\//.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  test('no fetch of a root path: fetch(withBase(...)) or API_BASE', () => {
    const offenders = files
      .filter(f => /fetch\(\s*["'`]\/(?!\/)/.test(f.text))
      // lib/api.ts prefixes every request with API_BASE, which the beta build
      // sets to /beta; its template literals start with ${API_BASE}, so they
      // do not match anyway. Listed here as documentation, not an exemption.
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  test('import.meta.env.BASE_URL is read only in lib/base-path.ts', () => {
    const offenders = files
      .filter(f => f.path !== BASE_MODULE)
      .filter(f => f.text.includes('import.meta.env.BASE_URL'))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});
