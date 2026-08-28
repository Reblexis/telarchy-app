import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * A drift guard, in the shape of api-parity.test.ts and the frontend's
 * floor-horizons-ownership.test.ts: the rule that keeps "how much has this
 * participant made" in one place is checked mechanically, because the bug it
 * prevents is invisible until two surfaces disagree in public.
 *
 * Why this file exists. The board's profit number is now read by three
 * surfaces: the public leaderboard, a participant's own profile, and a prize
 * season that decides who receives real money. Every visible floor bug in the
 * week of 2026-08-11 was one field disagreeing with another inside one screen,
 * and each was reported by the owner rather than caught by CI. A season makes
 * that failure mode expensive rather than embarrassing.
 *
 * The rules:
 *
 *   1. The arithmetic lives in `lib/leaderboard.ts` (`computeTradingProfit`),
 *      and nothing computes profit any other way. A second formula is a second
 *      answer to "what has this person made".
 *   2. The workspace-scoped SQL that feeds it lives in `lib/board.ts`
 *      (`loadBoard`). Anyone who needs the board asks for it there rather than
 *      writing their own aggregate, because those aggregates are the ones that
 *      OOM-killed the instance when they were written carelessly.
 *   3. Season scoring is `seasonScore` in `lib/seasons.ts` and nowhere else.
 *      "current minus baseline" is one subtraction; a second copy of it is how
 *      a standings page and a settlement disagree about a prize.
 *
 * A legitimate exception belongs in the allowlist below, WITH ITS REASON.
 */

const SRC = resolve(__dirname, '..');

/**
 * Files permitted to call `computeTradingProfit` directly.
 *
 * `lib/board.ts` is the owner: it does the SQL and hands back the map.
 *
 * `routes/agents.ts` is the one real exception. A participant's public profile
 * already holds the viewer-scoped trade and position rows in memory (it needs
 * them for the positions and recent-trades lists), and its workspace set is the
 * caller's visibility rather than "what is public", so routing it through
 * `loadBoard` would re-query what it already has and answer the wrong question.
 * It shares the arithmetic, which is the part that must not fork.
 */
const MAY_COMPUTE_PROFIT = new Set([
  // Defines it.
  'lib/leaderboard.ts',
  'lib/board.ts',
  'routes/agents.ts',
]);

/**
 * Files permitted to sum trade cost per agent in SQL.
 *
 * `lib/board.ts` owns the board's cross-workspace aggregate.
 *
 * `services/markets.ts` asks a different question with the same expression:
 * what one participant still has at stake in ONE market, which is what a void
 * refunds. It reads from trades rather than positions because
 * positions.totalCost is gross buys by design and cannot answer it. Not the
 * board, and not a second copy of it.
 */
const MAY_QUERY_BOARD = new Set(['lib/board.ts', 'services/markets.ts']);

/** Files permitted to compute a season score. */
const MAY_SCORE_SEASON = new Set(['lib/seasons.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).map(f => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }));

describe('season scoring ownership', () => {
  test('the test can actually see the source tree', () => {
    // A guard that greps an empty list passes forever and guards nothing.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some(f => f.rel === 'lib/board.ts')).toBe(true);
  });

  test('only lib/board.ts and routes/agents.ts compute trading profit', () => {
    const offenders = files
      .filter(f => !MAY_COMPUTE_PROFIT.has(f.rel))
      .filter(f => /\bcomputeTradingProfit\s*\(/.test(f.text))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  test("only lib/board.ts writes the board's SQL aggregate over trades", () => {
    // The signature of the board query: summing trade cost per agent. Written
    // anywhere else it is both a second answer and a second chance to pull the
    // 348k-row trades table into memory.
    const offenders = files
      .filter(f => !MAY_QUERY_BOARD.has(f.rel))
      .filter(f => /sum\(\$\{trades\.cost\}\)/.test(f.text))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  test('only lib/seasons.ts computes a season score', () => {
    // Everyone else imports seasonScore. The literal subtraction is the thing
    // that must not be re-derived at a call site.
    const offenders = files
      .filter(f => !MAY_SCORE_SEASON.has(f.rel))
      .filter(f => /currentProfit\s*-\s*baseline|profit\w*\s*-\s*\w*[Bb]aselineProfit/.test(f.text))
      .map(f => f.rel);
    expect(offenders).toEqual([]);
  });

  test('settlement does not read the display cache', () => {
    // A stale read is fine for a page and wrong for assigning money. The
    // settle path must clear the display caches and compute the settled
    // window directly (lib/board.ts loadSeasonSettled, since the 2026-08-28
    // settled-scoring amendment), never through the routes' cached helpers.
    const seasons = files.find(f => f.rel === 'routes/seasons.ts')!;
    const settle = seasons.text.slice(seasons.text.indexOf("'/:id/settle'"));
    expect(settle).toMatch(/clearBoardCache\(\)/);
    expect(settle).toMatch(/loadSeasonSettled\(/);
    expect(settle).not.toMatch(/cachedBoard\(|cachedSeasonSettled\(/);
  });

  test('the season standings path still reads the pinned set, to report what dropped out', () => {
    // Scoring runs over every workspace public at read time (owner decision
    // 2026-08-21, docs/seasons.md), but the pinned set stays the record of
    // what was public at the start, and workspacesDropped is derived from it.
    const lb = files.find(f => f.rel === 'routes/leaderboard.ts')!;
    const standings = lb.text.slice(lb.text.indexOf('async function seasonStandings'));
    expect(standings).toMatch(/season\.workspaceIds/);
  });
});
