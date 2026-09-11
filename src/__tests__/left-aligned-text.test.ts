import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Blocks of text are left-aligned (docs/ui-conventions.md, "Page layout";
 * owner rule 2026-09-04: "blocks of text shouldnt be cetner algigned").
 *
 * A headline or a one-line caption may sit centred. Anything that wraps is
 * set left, and because several of these paragraphs live inside a centred
 * hero and would inherit the centring, the declaration has to be explicit on
 * the paragraph's own class. This lists every class that carries a
 * multi-line sentence and checks the declaration is there.
 */

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'style.css'), 'utf8');

/** The body of the first plain (non-nested, non-media) rule for a class. */
function rule(cls: string): string {
  const re = new RegExp(`(^|\\n)\\.${cls.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = CSS.match(re);
  if (!m) throw new Error(`no rule for .${cls}`);
  return m[2];
}

const PROSE = [
  // doors and error states: the lead under the headline
  'pubws-pitch',
  // the floor
  'pubws-ws-what',
  'pubws-decides-p',
  'pubws-season',
  'pubws-settles',
  'pubws-na-note',
  'pubws-gap',
  'pubws-propose-cost',
  'pubws-provenance',
  // the live view's caption (docs/ui-conventions.md, "The live view")
  'pubws-live-caption',
  // the live segment's next-move line (docs/ui-conventions.md, "The live view is a segment of the chart slot")
  'snake-next',
  // a plan item's own words under the "What is planned" axis
  'pubws-tl-words',
  'pubws-publish-sub',
  'doors-note',
  // the home board, /owners, /forecast, /for-agents
  'mkt-lead',
  'setup-sub',
  // leaderboard, season, admin, announcements, data room
  'lbp-lead',
  'seasonp-pool-sub',
  'seasonp-experimental',
  'season-entry-note',
  'adm-lead',
  'annp-lead',
  'dr-lead',
];

describe('blocks of text are left-aligned', () => {
  for (const cls of PROSE) {
    test(`.${cls} declares text-align: left`, () => {
      const body = rule(cls);
      expect(body).not.toMatch(/text-align:\s*center/);
      expect(body).toMatch(/text-align:\s*left/);
    });
  }

  test('the scan sees a real rule', () => {
    expect(rule('pubws-gap')).toMatch(/max-width/);
  });
});
