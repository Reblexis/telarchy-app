/**
 * /api/leaderboard answers in TWO shapes from one path, and the catalog
 * has to say so.
 *
 * The bug this exists for (2026-08-31): an API consumer read a season
 * standing looking for `settledEarnings` and `projectedPayoutUsd`, the
 * field names the all-time board uses. A season row carries neither, so
 * every row came back as a plausible-looking 0.00 and the season appeared
 * to be paying nobody, when it was in fact allocating the whole pool.
 *
 * A silent zero is the worst answer an API can give: an unknown field
 * that reads as "no money" is indistinguishable from "no money". Nothing
 * in the response can prevent a caller reading a key that is not there,
 * so the defence is that `/api/help` names the fields of BOTH shapes, and
 * this test fails if either set stops being documented.
 *
 * Why it matters more here than elsewhere: this endpoint was deliberately
 * made to serve both questions so a standing and a board row could never
 * disagree about the same participant. That guarantee is worth nothing if
 * a reader cannot tell which shape they are holding.
 */

import { HELP } from '../lib/help-catalog';

const entry = (() => {
  const groups = (HELP as { endpoints?: unknown }).endpoints;
  const flat = Array.isArray(groups)
    ? groups
    : Object.values((groups ?? {}) as Record<string, unknown>).flatMap(g => (Array.isArray(g) ? g : []));
  return (flat as Array<{ method?: string; path?: string; description?: string }>).find(
    e => e.path === '/api/leaderboard',
  );
})();

describe('the leaderboard catalog entry', () => {
  test('exists at all', () => {
    expect(entry).toBeTruthy();
    expect(typeof entry?.description).toBe('string');
  });

  test('NAMES THE ALL-TIME ROW FIELDS', () => {
    const d = entry?.description ?? '';
    for (const field of ['totalEarnings', 'settledEarnings', 'openEarnings']) {
      expect(d).toContain(field);
    }
  });

  test('NAMES THE SEASON ROW FIELDS, which are different ones', () => {
    // The two that a caller coming from the all-time shape will not guess,
    // and whose absence reads as zero rather than as an error.
    const d = entry?.description ?? '';
    for (const field of ['score', 'projectedPrizeUsd']) {
      expect(d).toContain(field);
    }
  });

  test('WARNS THAT THE SHAPES DIFFER, in words, not just by listing both', () => {
    // Listing field names somewhere in 1,500 words is not the same as
    // telling somebody the shape changes under them.
    const d = (entry?.description ?? '').toLowerCase();
    expect(d).toMatch(/different (fields|shape)|not the same fields|shape differs|different row shape/);
  });
});
