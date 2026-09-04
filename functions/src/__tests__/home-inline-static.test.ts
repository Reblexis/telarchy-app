/**
 * The served home page carries the inlined payload (docs/ui-conventions.md,
 * "While a page loads"), which the SPA fallback in server.ts injects for the
 * exact path `/`. On 2026-09-04 the first publish shipped without it:
 * express.static answered `/` with index.html itself (its default `index`
 * option) before the fallback ever ran, while share links, which are not
 * files, fell through and got their hint. The public static middleware must
 * not serve directory indexes; only the fallback may answer `/`.
 *
 * server.ts is a boot script (it calls app.listen), so this pins the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');

describe('the home page reaches the inline-data handler', () => {
  test('the public static middleware serves no directory index, so `/` falls through to the fallback', () => {
    const block = SRC.slice(SRC.indexOf('express.static(publicDir'), SRC.indexOf("app.get('*'"));
    expect(block).toMatch(/index:\s*false/);
  });

  test('the fallback injects the home payload for the exact path `/`', () => {
    expect(SRC).toMatch(/req\.path === '\/'[\s\S]*?injectHomeData\(/);
  });
});
