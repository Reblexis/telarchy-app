import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, test } from 'vitest';

/**
 * One clock, four surfaces.
 *
 * The floor strip, the account entry panel, the leaderboard banner and the
 * standings page all print how long the season has. Each of them grew its own
 * `Math.ceil(ms / 86_400_000)`, which rounds differently depending on the
 * moment it runs, so the same screen could say "3 days left" in one place and
 * "2 days left" in another. Same shape as the floor-horizons drift that put a
 * week's chart under a year's market.
 *
 * The rule: only `lib/season-clock.ts` reads a season's dates. Everything else
 * takes `headline`, `remaining`, `phase` and `entryOpen` from it. A legitimate
 * exception goes in the allowlist below, with its reason.
 */

const SRC = resolve(__dirname, '../..');
const MODEL = 'lib/season-clock.ts';

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
  expect(files.map(f => f.path)).toContain(MODEL);
  expect(files.map(f => f.path)).toContain('components/SeasonEntryPanel.tsx');
});

describe("only the model reads a season's dates", () => {
  const ALLOWED = new Set([
    MODEL,
    'lib/api.ts', // the PrizeSeason type declaration
    'lib/useSeasonClock.ts', // the hook, which only passes `now` through
  ]);

  test('nothing else touches startsAt or endsAt', () => {
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .filter(f => /\b(startsAt|endsAt)\b/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  test('nothing else decides which season is the current one', () => {
    // Two components had grown the same "running, else soonest draft" sort.
    const offenders = files
      .filter(f => !ALLOWED.has(f.path))
      .filter(f => /status === 'draft'/.test(f.text) && /sort\(/.test(f.text))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});

test('the guard can actually fail', () => {
  // A rule nobody can trip is a comment. Prove the matcher fires on the exact
  // line this test exists to keep out.
  const regression = 'const daysLeft = Math.ceil((new Date(season.endsAt).getTime() - Date.now()) / 86_400_000);';
  expect(/\b(startsAt|endsAt)\b/.test(regression)).toBe(true);
});
