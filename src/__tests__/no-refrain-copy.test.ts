import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { AUDIENCE_PAGES } from '../content/audiencePages.generated';

/**
 * The copy is written for a reader, not for a rater (docs/ui-conventions.md,
 * "How much a page says"; AGENTS.md "Canonical positioning", revised
 * 2026-09-04). A reader called the site "cloyingly Claudish" and named two
 * habits: a refrain welded to every sentence ("human or AI", "calibrated
 * number"), and a sentence after every rule that argues the rule is harmless
 * ("your credits are never spent", "it can only add to a score"). Each
 * refrain may appear once on a page; the justification sentence may not
 * appear at all. Record: notes/decisions/ui-conventions.md, 2026-09-04.
 */

const ROOT = resolve(__dirname, '../..');

const PAGES = [
  'src/pages/AboutPage.tsx',
  'src/pages/FloorsPage.tsx',
  'src/pages/SeasonPage.tsx',
  'src/pages/WaitlistPage.tsx',
  'src/pages/LeaderPage.tsx',
  'src/pages/EarnPage.tsx',
  'src/pages/FundingPage.tsx',
  'src/components/SeasonEntryButton.tsx',
  'docs/guides/overview.md',
  'docs/guides/seasons.md',
  'docs/guides/credits.md',
];

/** JSX and markdown with the comments stripped, so a code comment quoting the old copy does not count. */
function prose(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const REFRAINS = [/human or AI/gi, /calibrated number/gi];

const JUSTIFICATIONS = [
  /that is the point/i,
  /on purpose/i,
  /which is what (makes|keeps)/i,
  /is deliberate/i,
  /both halves/i,
  /never take one away/i,
  /reduces nobody/i,
  /only increases what is paid/i,
  /credits are never spent/i,
  /only used to tell you/i,
  /worth internalising/i,
];

describe('a refrain appears once on a page, and a rule is not followed by its own defence', () => {
  const surfaces: { name: string; text: string }[] = [
    ...PAGES.map(p => ({ name: p, text: prose(p) })),
    ...AUDIENCE_PAGES.map(p => ({ name: p.route, text: `${p.description} ${JSON.stringify(p.blocks)}` })),
  ];

  for (const s of surfaces) {
    test(`${s.name}: "human or AI" and "calibrated number" at most once each`, () => {
      for (const r of REFRAINS) {
        const n = (s.text.match(r) ?? []).length;
        expect(n, `${r.source} appears ${n} times`).toBeLessThanOrEqual(1);
      }
    });

    test(`${s.name}: no sentence argues for the rule before it`, () => {
      for (const j of JUSTIFICATIONS) expect(s.text, j.source).not.toMatch(j);
    });
  }

  test('the season entry dialog is the fields, the two boxes and the button, with no note under it', () => {
    // The rules link above the button and the terms carry the free-entry
    // statement; the dialog does not restate it, and the stale "starting
    // score" note (baselines went with the 2026-08-28 amendment) is gone.
    const dialog = prose('src/components/SeasonEntryButton.tsx');
    expect(dialog).not.toMatch(/Free to enter/);
    expect(dialog).not.toMatch(/starting score/);
  });
});
